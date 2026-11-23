/**
 * AI fuel: the agent turns what holders pay it into BRRRAIN, so its AI quota grows with funding.
 *
 * Holders fund a token's agent budget (votes or "Fund the agent"); every post is paid from that
 * budget in the token's staking token (LiNEAR for older tokens, stNEAR for new ones), credited to
 * the operator on the launchpad. Every few hours this loop:
 *   1. withdraws the operator's claimable LiNEAR and stNEAR from the launchpad,
 *   2. keeps a share of each for gas and post deposits,
 *   3. swaps the rest -> ... -> BRRRAIN on Rhea, along BRRRAIN_ROUTE (from LiNEAR) and
 *      BRRRAIN_ROUTE_STNEAR (from stNEAR), quoted, 2% max slippage,
 *   4. holds the BRRRAIN in the account behind the BRRRAIN API key (the operator, or
 *      BRRRAIN_HOLDER), which BRRRAIN pays out as daily Power from the next day (00:00 UTC).
 *
 * BRRRAIN only exists on mainnet (token.brrrain.near). On testnet, or with no route set for a
 * token, the loop runs in dry-run mode for it: it logs what it would claim and buy and moves nothing.
 */
import type { Account } from "near-api-js";

const TGAS = 10n ** 12n;
const ONE_YOCTO = 1n;
const STORAGE_DEPOSIT = 1_250_000_000_000_000_000_000n; // 0.00125 NEAR

export interface FuelDeps {
  network: string;
  operator: Account;
  operatorId: string;
  launchpad: string;
  refExchange: string;
  linear: string;
  stnear: string;
  /** Runs one signed transaction at a time with the agent's other calls (shared nonce). */
  signed: <T>(fn: () => Promise<T>) => Promise<T>;
}

interface Hop {
  pool: number;
  tokenOut: string;
}

const env = (k: string, d = "") => process.env[k] ?? d;
const EVERY_MS = Number(env("BRRRAIN_FUEL_HOURS", "6")) * 3600_000;
/** Share of the agent's pay turned into BRRRAIN; the rest stays for gas. */
const FUEL_BPS = BigInt(Math.min(10_000, Math.max(0, Number(env("BRRRAIN_FUEL_BPS", "8000")))));
const MIN_SPEND = BigInt(Math.round(Number(env("BRRRAIN_FUEL_MIN_LINEAR", "0.5")) * 1e6)) * 10n ** 18n;
const SLIPPAGE_BPS = 200n;

const parseRoute = (raw: string): Hop[] =>
  raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [pool, tokenOut] = s.split(":");
      return { pool: Number(pool), tokenOut: tokenOut?.trim() ?? "" };
    });

function fuelConfig(network: string) {
  const token = env("BRRRAIN_TOKEN", network === "mainnet" ? "token.brrrain.near" : "");
  const ok = (r: Hop[]) => r.length > 0 && r.every((h) => Number.isInteger(h.pool) && h.tokenOut) && r[r.length - 1].tokenOut === token;
  // "pool:tokenOut,pool:tokenOut", from the staking token to the BRRRAIN token
  const routes = { LiNEAR: parseRoute(env("BRRRAIN_ROUTE")), stNEAR: parseRoute(env("BRRRAIN_ROUTE_STNEAR")) };
  const on = env("BRRRAIN_FUEL", network === "mainnet" ? "on" : "off") === "on" && !!token;
  return {
    token,
    routes,
    live: { LiNEAR: on && ok(routes.LiNEAR), stNEAR: on && ok(routes.stNEAR) },
    holder: env("BRRRAIN_HOLDER"),
  };
}

const fmt = (raw: bigint, dp = 4) => (Number(raw / 10n ** 18n) / 1e6).toFixed(dp);

/** One line for the startup SETUP block. */
export function fuelSetupLine(network: string): string {
  const c = fuelConfig(network);
  const liveFor = (["LiNEAR", "stNEAR"] as const).filter((s) => c.live[s]);
  if (liveFor.length) {
    return `✓ SETUP: AI fuel on for ${liveFor.join(" + ")}: ${Number(FUEL_BPS) / 100}% of the agent's pay buys BRRRAIN (${c.token}) every ${EVERY_MS / 3600_000}h${c.holder ? `, held by ${c.holder}` : ""}`;
  }
  const why = !c.token
    ? "no BRRRAIN token on this network"
    : env("BRRRAIN_FUEL", network === "mainnet" ? "on" : "off") !== "on"
      ? "BRRRAIN_FUEL is off"
      : "set BRRRAIN_ROUTE_STNEAR / BRRRAIN_ROUTE (pool:tokenOut,... from stNEAR / LiNEAR to the BRRRAIN token)";
  return `• SETUP: AI fuel in dry-run (${why}): the agent logs what it would buy and moves nothing`;
}

let lastRun = 0;

/** Claim the agent's pay and buy BRRRAIN with it (dry-run unless configured, see above). */
export async function fuelBrrrain(d: FuelDeps): Promise<void> {
  if (Date.now() - lastRun < EVERY_MS) return;
  lastRun = Date.now();
  const c = fuelConfig(d.network);
  const viewOn = <T>(contractId: string, methodName: string, args: object) =>
    d.operator.viewFunction({ contractId, methodName, args }) as Promise<T>;
  const symbolOf = (id: string) => (id === d.stnear ? "stNEAR" : id === d.linear ? "LiNEAR" : id);

  // what the launchpad owes the agent, per staking token (older contracts: LiNEAR only)
  const claims = await viewOn<[string, string][]>(d.launchpad, "get_claimable", { account_id: d.operatorId }).catch(async () => [
    [d.linear, await viewOn<string>(d.launchpad, "get_claimable_linear", { account_id: d.operatorId })] as [string, string],
  ]);
  const plan = claims
    .map(([id, amt]) => ({ id, symbol: symbolOf(id), claimable: BigInt(amt) }))
    .map((x) => ({ ...x, spend: (x.claimable * FUEL_BPS) / 10_000n })) // only newly earned pay is spent
    .filter((x) => x.spend >= MIN_SPEND);
  if (plan.length === 0) {
    const owed = claims.map(([id, amt]) => `${fmt(BigInt(amt))} ${symbolOf(id)}`).join(" + ") || "nothing";
    console.log(`AI fuel: ${owed} earned since the last buy, waiting for enough to buy BRRRAIN`);
    return;
  }
  const isLive = (s: string) => (s === "stNEAR" ? c.live.stNEAR : s === "LiNEAR" ? c.live.LiNEAR : false);
  for (const p of plan.filter((x) => !isLive(x.symbol))) {
    console.log(
      `AI fuel (dry-run): would claim ${fmt(p.claimable)} ${p.symbol} and swap ${fmt(p.spend)} for BRRRAIN` +
        `${c.token ? ` (${c.token})` : ""}, keeping ${fmt(p.claimable - p.spend)} ${p.symbol} for gas. ${fuelSetupLine(d.network).replace(/^.*SETUP: /, "")}`,
    );
  }
  const live = plan.filter((x) => isLive(x.symbol));
  if (live.length === 0) return;

  const call = (contractId: string, methodName: string, args: object, gasTgas: bigint, deposit: bigint) =>
    d.signed(async () => {
      const res = await d.operator.functionCall({ contractId, methodName, args, gas: gasTgas * TGAS, attachedDeposit: deposit });
      const failed = JSON.stringify(res.receipts_outcome.map((o) => o.outcome.status)).includes("Failure");
      console.log(`${failed ? "✗" : "✓"} AI fuel ${contractId}.${methodName} tx=${res.transaction.hash}`);
      return !failed;
    });

  // 1. claim the agent's pay (withdraw_linear pays every staking token at once)
  for (const p of live) {
    const reg = await viewOn<unknown>(p.id, "storage_balance_of", { account_id: d.operatorId }).catch(() => null);
    if (!reg && !(await call(p.id, "storage_deposit", { account_id: d.operatorId, registration_only: true }, 10n, STORAGE_DEPOSIT))) return;
  }
  if (!(await call(d.launchpad, "withdraw_linear", {}, 60n, ONE_YOCTO))) return;

  // 2. the operator must be registered on the BRRRAIN token to receive it
  const reg = await viewOn<unknown>(c.token, "storage_balance_of", { account_id: d.operatorId }).catch(() => null);
  if (!reg && !(await call(c.token, "storage_deposit", { account_id: d.operatorId, registration_only: true }, 10n, STORAGE_DEPOSIT))) return;

  let bought = 0n;
  for (const p of live) {
    const route = p.symbol === "stNEAR" ? c.routes.stNEAR : c.routes.LiNEAR;
    const balance = BigInt(await viewOn<string>(p.id, "ft_balance_of", { account_id: d.operatorId }));
    const amountIn = p.spend < balance ? p.spend : balance;
    if (amountIn < MIN_SPEND) continue;

    // 3. quote the route on Rhea and set the minimum output
    let quoted = amountIn;
    let tokenIn = p.id;
    for (const h of route) {
      quoted = BigInt(
        await viewOn<string>(d.refExchange, "get_return", { pool_id: h.pool, token_in: tokenIn, amount_in: quoted.toString(), token_out: h.tokenOut }),
      );
      tokenIn = h.tokenOut;
    }
    if (quoted === 0n) {
      console.warn(`AI fuel: Rhea quoted 0 BRRRAIN from ${p.symbol}; skipping`);
      continue;
    }
    const minOut = (quoted * (10_000n - SLIPPAGE_BPS)) / 10_000n;

    // 4. swap in one transaction: staking token -> ... -> BRRRAIN, sent back to the operator
    let from = p.id;
    const actions = route.map((h, i) => {
      const a = {
        pool_id: h.pool,
        token_in: from,
        token_out: h.tokenOut,
        ...(i === 0 ? { amount_in: amountIn.toString() } : {}),
        min_amount_out: i === route.length - 1 ? minOut.toString() : "0",
      };
      from = h.tokenOut;
      return a;
    });
    const before = BigInt(await viewOn<string>(c.token, "ft_balance_of", { account_id: d.operatorId }));
    const ok = await call(
      p.id,
      "ft_transfer_call",
      { receiver_id: d.refExchange, amount: amountIn.toString(), msg: JSON.stringify({ actions, skip_unwrap_near: true }) },
      200n,
      ONE_YOCTO,
    );
    if (!ok) continue;
    const after = BigInt(await viewOn<string>(c.token, "ft_balance_of", { account_id: d.operatorId }));
    bought += after - before;
    console.log(`AI fuel: bought ${fmt(after - before, 2)} BRRRAIN with ${fmt(amountIn)} ${p.symbol}; Power from it starts at the next 00:00 UTC`);
  }

  // 5. Power goes to the account behind the API key: move it there if that is another account
  if (c.holder && c.holder !== d.operatorId && bought > 0n) {
    const hreg = await viewOn<unknown>(c.token, "storage_balance_of", { account_id: c.holder }).catch(() => null);
    if (!hreg) await call(c.token, "storage_deposit", { account_id: c.holder, registration_only: true }, 10n, STORAGE_DEPOSIT);
    await call(c.token, "ft_transfer", { receiver_id: c.holder, amount: bought.toString(), memo: "floorpad agent AI fuel" }, 10n, ONE_YOCTO);
  }
}
