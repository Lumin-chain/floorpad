/**
 * Getting from LiNEAR back to NEAR.
 *
 * Two routes:
 * - Swap now on Rhea (Ref): the rated LiNEAR/wNEAR pool prices LiNEAR at its staking rate and
 *   is far deeper than the simple pool. Rated pools refuse to trade once their cached rate
 *   expires, so the swap is preceded by `update_token_rate` (Rhea's own app does the same).
 * - Unstake on LiNEAR: full value, paid after a few epochs; then `withdraw_all`.
 */
import { LINEAR, LINEAR_WNEAR_POOL, NETWORK, REF, view, WNEAR, YOCTO } from "./near";
import type { Tx } from "./wallet";

/** Rated LiNEAR/wNEAR pool. Testnet: #571. Set NEXT_PUBLIC_LINEAR_RATED_POOL to use one on mainnet. */
export const LINEAR_RATED_POOL: number | null = process.env.NEXT_PUBLIC_LINEAR_RATED_POOL
  ? Number(process.env.NEXT_PUBLIC_LINEAR_RATED_POOL)
  : NETWORK === "testnet"
    ? 571
    : null;

export interface LinearQuote {
  pool: number;
  rated: boolean;
  /** wNEAR out; null when the rated pool's rate expired (it is refreshed inside the swap). */
  out: bigint | null;
}

async function quote(pool: number, amount: bigint): Promise<bigint | null> {
  return view<string>(REF, "get_return", { pool_id: pool, token_in: LINEAR, amount_in: amount.toString(), token_out: WNEAR })
    .then((x) => BigInt(x))
    .catch(() => null);
}

/** Best pool for selling `amount` LiNEAR right now. */
export async function bestLinearQuote(amount: bigint): Promise<LinearQuote> {
  const [rated, simple] = await Promise.all([
    LINEAR_RATED_POOL !== null ? quote(LINEAR_RATED_POOL, amount) : Promise.resolve(null),
    quote(LINEAR_WNEAR_POOL, amount),
  ]);
  if (LINEAR_RATED_POOL !== null && (rated === null || simple === null || rated >= simple)) {
    // An expired rate makes the view fail; the swap refreshes it first, so the rated pool is still the pick.
    return { pool: LINEAR_RATED_POOL, rated: true, out: rated };
  }
  return { pool: LINEAR_WNEAR_POOL, rated: false, out: simple };
}

/** Transactions that refresh the rated pool's LiNEAR rate when needed (prepend before a swap). */
export function rateRefreshTxs(q: Pick<LinearQuote, "rated">): Tx[] {
  return q.rated ? [{ receiverId: REF, calls: [{ method: "update_token_rate", args: { token_id: LINEAR }, gas: 60 }] }] : [];
}

/** Swap `amount` LiNEAR for native NEAR on the chosen pool, paid to `account`. */
export function linearSwapTxs(account: string, amount: bigint, q: LinearQuote, minOut: bigint): Tx[] {
  const msg = JSON.stringify({
    actions: [{ pool_id: q.pool, token_in: LINEAR, token_out: WNEAR, min_amount_out: minOut.toString() }],
    swap_out_recipient: account,
    skip_unwrap_near: false,
  });
  return [
    ...rateRefreshTxs(q),
    {
      receiverId: LINEAR,
      calls: [{ method: "ft_transfer_call", args: { receiver_id: REF, amount: amount.toString(), msg }, gas: 150, deposit: "1" }],
    },
  ];
}

/** Unstake `shares` LiNEAR worth of NEAR (LiNEAR's `unstake` takes the NEAR amount). */
export function unstakeTxs(shares: bigint, price: bigint): Tx[] {
  const near = (shares * price) / YOCTO;
  const amount = (near * 9999n) / 10000n; // stay just under the share value (rounding)
  return [{ receiverId: LINEAR, calls: [{ method: "unstake", args: { amount: amount.toString() }, gas: 150 }] }];
}

export const withdrawUnstakedTxs = (): Tx[] => [{ receiverId: LINEAR, calls: [{ method: "withdraw_all", args: {}, gas: 50 }] }];

export interface LinearAccount {
  unstaked_balance: string;
  staked_balance: string;
  unstaked_available_epoch_height: number;
  can_withdraw: boolean;
}

export const linearAccount = (account: string) =>
  view<LinearAccount>(LINEAR, "get_account_details", { account_id: account }).catch(() => null);

/** Open the Convert LiNEAR modal from anywhere. */
export const openConvertLinear = (token?: string | unknown) =>
  window.dispatchEvent(new CustomEvent("floorpad:convert-linear", { detail: { token: typeof token === "string" ? token : undefined } }));
