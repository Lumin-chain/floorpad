/**
 * The liquid staking token behind each Floorpad token, and the ways back to NEAR.
 *
 * Tokens launched before the switch use LiNEAR (their Rhea liquidity is locked forever); new
 * launches use stNEAR from Meta Pool, which can be turned into NEAR instantly. The contract
 * reports it per token as `stake_token`.
 *
 * Exits to NEAR:
 * - Swap on Rhea's rated pool (prices the token at its staking rate). Rated pools refuse to
 *   trade once their cached rate expires, so swaps are preceded by `update_token_rate`.
 * - stNEAR only: Meta Pool's instant unstake (`liquid_unstake`), paid at once in NEAR from its
 *   liquidity pool for a small fee.
 * - Delayed unstake (full value after a few epochs).
 */
import { LINEAR, LINEAR_WNEAR_POOL, NETWORK, REF, view, WNEAR, YOCTO } from "./near";
import type { Tx } from "./wallet";

export const STNEAR =
  process.env.NEXT_PUBLIC_STNEAR ?? (NETWORK === "mainnet" ? "meta-pool.near" : "meta-v2.pool.testnet");

export type StakeKind = "linear" | "meta";

export interface StakeInfo {
  id: string;
  symbol: string;
  kind: StakeKind;
  /** Rhea rated pool against wNEAR (deepest exit), if any. */
  ratedPool: number | null;
  /** Rhea simple pool against wNEAR, if any. */
  simplePool: number | null;
}

const LINEAR_INFO: StakeInfo = {
  id: LINEAR,
  symbol: "LiNEAR",
  kind: "linear",
  ratedPool: process.env.NEXT_PUBLIC_LINEAR_RATED_POOL
    ? Number(process.env.NEXT_PUBLIC_LINEAR_RATED_POOL)
    : NETWORK === "mainnet"
      ? 3515
      : 571,
  simplePool: LINEAR_WNEAR_POOL,
};

const STNEAR_INFO: StakeInfo = {
  id: STNEAR,
  symbol: "stNEAR",
  kind: "meta",
  ratedPool: Number(process.env.NEXT_PUBLIC_STNEAR_RATED_POOL ?? (NETWORK === "mainnet" ? "3514" : "568")),
  simplePool: NETWORK === "mainnet" ? 535 : null,
};

export function stakeInfo(id?: string | null): StakeInfo {
  if (id && id === STNEAR) return STNEAR_INFO;
  if (!id || id === LINEAR) return LINEAR_INFO;
  return { id, symbol: id.split(".")[0], kind: "linear", ratedPool: null, simplePool: null };
}

/** The staking token behind a Floorpad token (LiNEAR for tokens that predate the field). */
export const stakeOf = (t: { stake_token?: string | null }) => stakeInfo(t.stake_token);

/** Meta Pool takes at least 1 NEAR per stake. */
export const META_MIN_STAKE = YOCTO;

/** NEAR per staking token, scaled 1e24. */
export async function stakePrice(id: string): Promise<bigint> {
  const method = stakeInfo(id).kind === "meta" ? "get_st_near_price" : "ft_price";
  return BigInt(await view<string>(id, method));
}

/** Delayed-unstake time, for copy. */
export const unstakeDelayText = (s: StakeInfo) => (s.kind === "meta" ? "about 4 epochs (2-3 days)" : "4-5 epochs (2-3 days)");

// ---------- swaps on Rhea ----------

export interface ExitQuote {
  pool: number;
  rated: boolean;
  /** wNEAR out; null when the rated pool's rate expired (it is refreshed inside the swap). */
  out: bigint | null;
}

async function quote(pool: number, tokenIn: string, tokenOut: string, amount: bigint): Promise<bigint | null> {
  return view<string>(REF, "get_return", { pool_id: pool, token_in: tokenIn, amount_in: amount.toString(), token_out: tokenOut })
    .then((x) => BigInt(x))
    .catch(() => null);
}

/** Best Rhea pool for selling `amount` of the staking token for NEAR right now. */
export async function bestExitQuote(s: StakeInfo, amount: bigint): Promise<ExitQuote> {
  const [rated, simple] = await Promise.all([
    s.ratedPool !== null ? quote(s.ratedPool, s.id, WNEAR, amount) : Promise.resolve(null),
    s.simplePool !== null ? quote(s.simplePool, s.id, WNEAR, amount) : Promise.resolve(null),
  ]);
  if (s.ratedPool !== null && (rated === null || simple === null || rated >= simple)) {
    // An expired rate makes the view fail; the swap refreshes it first, so the rated pool is still the pick.
    return { pool: s.ratedPool, rated: true, out: rated };
  }
  return { pool: s.simplePool ?? (s.ratedPool as number), rated: false, out: simple };
}

/** Best Rhea pool for buying the staking token with `amount` wNEAR (small stNEAR buys). */
export async function bestEntryQuote(s: StakeInfo, amount: bigint): Promise<ExitQuote> {
  const [rated, simple] = await Promise.all([
    s.ratedPool !== null ? quote(s.ratedPool, WNEAR, s.id, amount) : Promise.resolve(null),
    s.simplePool !== null ? quote(s.simplePool, WNEAR, s.id, amount) : Promise.resolve(null),
  ]);
  if (s.ratedPool !== null && (rated === null || simple === null || rated >= simple)) {
    return { pool: s.ratedPool, rated: true, out: rated };
  }
  return { pool: s.simplePool ?? (s.ratedPool as number), rated: false, out: simple };
}

/** Refreshes the rated pool's rate when the swap uses it (prepend before the swap). */
export function rateRefreshFor(s: StakeInfo, q: Pick<ExitQuote, "rated">): Tx[] {
  return q.rated ? [{ receiverId: REF, calls: [{ method: "update_token_rate", args: { token_id: s.id }, gas: 60 }] }] : [];
}

/** Swap `amount` of the staking token for native NEAR on the chosen pool, paid to `account`. */
export function exitSwapTxs(account: string, s: StakeInfo, amount: bigint, q: ExitQuote, minOut: bigint): Tx[] {
  const msg = JSON.stringify({
    actions: [{ pool_id: q.pool, token_in: s.id, token_out: WNEAR, min_amount_out: minOut.toString() }],
    swap_out_recipient: account,
    skip_unwrap_near: false,
  });
  return [
    ...rateRefreshFor(s, q),
    { receiverId: s.id, calls: [{ method: "ft_transfer_call", args: { receiver_id: REF, amount: amount.toString(), msg }, gas: 150, deposit: "1" }] },
  ];
}

// ---------- Meta Pool instant unstake ----------

/** NEAR paid now for `amount` stNEAR through Meta Pool's instant unstake (after its fee). */
export async function instantUnstakeQuote(amount: bigint): Promise<bigint | null> {
  return view<string>(STNEAR, "get_near_amount_sell_stnear", { stnear_to_sell: amount.toString() })
    .then((x) => BigInt(x))
    .catch(() => null);
}

/** Meta Pool's instant-unstake liquidity right now (NEAR) and its current fee (bps). */
export async function instantUnstakeLiquidity(): Promise<{ near: bigint; feeBps: number } | null> {
  return view<{ nslp_liquidity: string; nslp_current_discount_basis_points: number }>(STNEAR, "get_contract_state")
    .then((s) => ({ near: BigInt(s.nslp_liquidity), feeBps: s.nslp_current_discount_basis_points }))
    .catch(() => null);
}

/** Burn `amount` stNEAR for NEAR now (Meta Pool `liquid_unstake`). */
export const instantUnstakeTxs = (amount: bigint, minNear: bigint): Tx[] => [
  {
    receiverId: STNEAR,
    calls: [{ method: "liquid_unstake", args: { st_near_to_burn: amount.toString(), min_expected_near: minNear.toString() }, gas: 100 }],
  },
];

// ---------- staking NEAR in ----------

/**
 * Stake `near` and send the minted shares on with `ft_transfer_call` in one transaction.
 * `price` is NEAR per share; shares are estimated 0.5% low so the transfer never exceeds the mint.
 */
export function stakeAndCallTx(s: StakeInfo, near: bigint, price: bigint, receiver: string, msg: string): Tx {
  const shares = (((near * YOCTO) / price) * 995n) / 1000n;
  return {
    receiverId: s.id,
    calls: [
      { method: "deposit_and_stake", args: {}, gas: 50, deposit: near.toString() },
      { method: "ft_transfer_call", args: { receiver_id: receiver, amount: shares.toString(), msg }, gas: 200, deposit: "1" },
    ],
  };
}

/** Why `near` can't be staked directly into `s`, or null. */
export function stakeMinError(s: StakeInfo, near: bigint): string | null {
  return s.kind === "meta" && near < META_MIN_STAKE ? "Meta Pool stakes at least 1 NEAR at a time." : null;
}

// ---------- claimable balances on the launchpad ----------

export interface Claim {
  token: string;
  symbol: string;
  amount: bigint;
}

/**
 * Everything `account` can withdraw from the launchpad (redemptions, airdrops, agent pay,
 * refunds), per staking token. Falls back to the LiNEAR-only view on older contracts.
 */
export async function getClaims(lpView: <T>(m: string, a: object) => Promise<T>, account: string): Promise<Claim[]> {
  try {
    const rows = await lpView<[string, string][]>("get_claimable", { account_id: account });
    return rows.map(([token, amount]) => ({ token, symbol: stakeInfo(token).symbol, amount: BigInt(amount) })).filter((c) => c.amount > 0n);
  } catch {
    const v = BigInt(await lpView<string>("get_claimable_linear", { account_id: account }).catch(() => "0"));
    return v > 0n ? [{ token: LINEAR, symbol: "LiNEAR", amount: v }] : [];
  }
}

/** "1.2 stNEAR + 0.3 LiNEAR" */
export const claimsText = (claims: Claim[] | undefined, fmt: (v: bigint) => string) =>
  claims && claims.length ? claims.map((c) => `${fmt(c.amount)} ${c.symbol}`).join(" + ") : "0";
