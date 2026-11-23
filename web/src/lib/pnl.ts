/**
 * Position accounting shared by the portfolio page and the PnL card, so both always agree.
 *
 * - Trades: the wallet's full history for one token from the trade index (curve trades and Ref
 *   swaps), falling back to the launchpad's on-chain log (recent curve trades only).
 * - Cost basis: average cost. A buy adds its NEAR and tokens; a sell removes the same share of
 *   cost as of tokens and realizes the difference.
 * - Value: what the holding returns if exited now, the better of selling on the market (a real
 *   quote, after the token's sell tax) and redeeming at the floor. Tokens x spot price overstates
 *   badly on thin pools, so it is never used as the value.
 */
import { isGraduated, LINEAR, lp, REF, view, YOCTO, type Quote, type TokenView } from "./near";
import { getAccountTrades } from "./social";

export interface PositionTrade {
  ts: number;
  isBuy: boolean;
  /** NEAR spent (buy) or received (sell), yocto. */
  near: bigint;
  /** Tokens bought or sold, raw. */
  tokens: bigint;
}

export async function loadAccountTrades(t: TokenView, account: string): Promise<PositionTrade[]> {
  const indexed = await getAccountTrades(t.token_id, account);
  if (indexed.length > 0) {
    return indexed.map((r) => ({ ts: r.ts, isBuy: Boolean(r.is_buy), near: BigInt(r.near), tokens: BigInt(r.tokens) }));
  }
  // No index available: the launchpad keeps the most recent curve trades on-chain.
  const chain = await lp<{ ts: number; account: string; is_buy: boolean; near: string; tokens: string }[]>("get_trades", {
    token_id: t.token_id,
  }).catch(() => []);
  return chain
    .filter((r) => r.account === account)
    .map((r) => ({ ts: r.ts, isBuy: r.is_buy, near: BigInt(r.near), tokens: BigInt(r.tokens) }));
}

export interface CostBasis {
  /** Total NEAR spent on buys. */
  invested: bigint;
  /** Total NEAR received from sells. */
  returned: bigint;
  /** Cost of the tokens still held (average cost). */
  costHeld: bigint;
  /** Tokens still held according to the trades (transfers in/out are not trades). */
  tokensHeld: bigint;
  /** Realized PnL from sells, yocto (signed). */
  realized: bigint;
  buys: number;
  sells: number;
}

export function costBasis(trades: PositionTrade[]): CostBasis {
  const b: CostBasis = { invested: 0n, returned: 0n, costHeld: 0n, tokensHeld: 0n, realized: 0n, buys: 0, sells: 0 };
  for (const tr of [...trades].sort((x, y) => x.ts - y.ts)) {
    if (tr.isBuy) {
      b.invested += tr.near;
      b.costHeld += tr.near;
      b.tokensHeld += tr.tokens;
      b.buys++;
    } else {
      const sold = tr.tokens < b.tokensHeld ? tr.tokens : b.tokensHeld;
      const costOut = b.tokensHeld > 0n ? (b.costHeld * sold) / b.tokensHeld : 0n;
      b.returned += tr.near;
      b.realized += tr.near - costOut;
      b.costHeld -= costOut;
      b.tokensHeld -= sold;
      b.sells++;
    }
  }
  return b;
}

interface TokenTax {
  config: { platform_fee_bps: number; sell_tax_bps: number; max_exit_fee_bps: number; decay_secs: number };
  decay_active: boolean;
}

export interface ExitValue {
  /** NEAR the holding returns if exited now (best route). */
  near: bigint;
  via: "market" | "floor";
  market: bigint;
  floor: bigint;
}

/** Best exit for `amount` tokens right now: market sell (after tax) or floor redemption. */
export async function exitValue(
  t: TokenView,
  amount: bigint,
  ageSecs: number,
  linearPrice: bigint,
  refPool?: { token_account_ids: string[]; amounts: string[] } | null,
): Promise<ExitValue> {
  if (amount <= 0n) return { near: 0n, via: "market", market: 0n, floor: 0n };
  const grad = isGraduated(t);
  const linP = linearPrice > 0n ? linearPrice : YOCTO;
  const floorQ = await lp<Quote>("quote_redeem", { token_id: t.token_id, tokens_in: amount.toString(), age_secs: ageSecs }).catch(() => null);
  const floor = floorQ ? (grad ? (BigInt(floorQ.amount_out) * linP) / YOCTO : BigInt(floorQ.amount_out)) : 0n;

  let market = 0n;
  if (grad && t.pool_id !== null) {
    const tax = await view<TokenTax>(t.token_id, "get_tax").catch(() => null);
    let bps = tax?.config.platform_fee_bps ?? 0;
    if (tax?.decay_active) {
      const exit = tax.config.decay_secs > 0 ? (tax.config.max_exit_fee_bps * Math.max(0, tax.config.decay_secs - ageSecs)) / tax.config.decay_secs : 0;
      bps += tax.config.sell_tax_bps + Math.floor(exit);
    }
    const net = (amount * BigInt(Math.max(0, 10000 - bps))) / 10000n;
    const lin = await view<string>(REF, "get_return", { pool_id: t.pool_id, token_in: t.token_id, amount_in: net.toString(), token_out: t.stake_token ?? LINEAR })
      .then((x) => BigInt(x))
      .catch(() => 0n);
    market = (lin * linP) / YOCTO;
    void refPool;
  } else if (t.grad_stage === "Curve") {
    const q = await lp<Quote>("quote_sell", { token_id: t.token_id, tokens_in: amount.toString(), age_secs: ageSecs }).catch(() => null);
    market = q ? BigInt(q.amount_out) : 0n;
  }
  return market >= floor ? { near: market, via: "market", market, floor } : { near: floor, via: "floor", market, floor };
}

export interface PositionSummary {
  held: bigint;
  basis: CostBasis;
  value: ExitValue;
  /** value + returned - invested, yocto (signed). */
  pnlNear: bigint;
  /** PnL as a percent of everything invested; null when there were no buys. */
  pnlPct: number | null;
  /** Average cost per whole token of what is still held, NEAR; null without buys. */
  entryPriceNear: number | null;
}

export async function positionSummary(
  t: TokenView,
  account: string,
  held: bigint,
  ageSecs: number,
  linearPrice: bigint,
): Promise<PositionSummary> {
  const [trades, value] = await Promise.all([loadAccountTrades(t, account), exitValue(t, held, ageSecs, linearPrice)]);
  const basis = costBasis(trades);
  const pnlNear = value.near + basis.returned - basis.invested;
  const pnlPct = basis.invested > 0n ? (Number((pnlNear * 1_000_000n) / basis.invested) / 1_000_000) * 100 : null;
  const entryPriceNear =
    basis.tokensHeld > 0n ? Number((basis.costHeld * 10n ** 12n) / basis.tokensHeld) / 1e18 : basis.buys > 0 && basis.invested > 0n ? null : null;
  return { held, basis, value, pnlNear, pnlPct, entryPriceNear };
}

/** Everything the wallet holds of a token: wallet + instant-trading custody + ve-lock. */
export async function heldAmount(t: TokenView, account: string, walletBalance?: bigint): Promise<{ total: bigint; wallet: bigint; custody: bigint; locked: bigint }> {
  const [wallet, custody, pos] = await Promise.all([
    walletBalance !== undefined
      ? Promise.resolve(walletBalance)
      : view<string>(t.token_id, "ft_balance_of", { account_id: account }).then((x) => BigInt(x)).catch(() => 0n),
    lp<{ amount: string }>("get_custody", { token_id: t.token_id, account_id: account }).then((c) => BigInt(c?.amount ?? "0")).catch(() => 0n),
    lp<{ amount: string } | null>("get_position", { token_id: t.token_id, account_id: account }).catch(() => null),
  ]);
  const locked = pos ? BigInt(pos.amount) : 0n;
  return { total: wallet + custody + locked, wallet, custody, locked };
}
