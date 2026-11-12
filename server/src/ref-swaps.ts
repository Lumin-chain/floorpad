/**
 * Reads post-graduation trades straight from the chain.
 *
 * After graduation a token trades on its locked Ref Finance pool, and those swaps never pass
 * through the launchpad's trade log. This module lists every transaction that touched the
 * token account (FastNEAR transactions API), then reads each Ref `ft_on_transfer` receipt:
 * its args give the trader and the swap actions (with pool ids), and Ref logs one
 * "Swapped <in> <token_in> for <out> <token_out>" line per executed action. Only actions on
 * the token's own pool are returned, so swaps in any other pool for the same token are ignored.
 *
 * No client input is trusted: everything comes from finalized chain data.
 * Kept dependency-free so the standalone social server can carry an identical copy.
 */

export interface RefSwap {
  /** stable unique key: tx hash + receipt id + action index */
  key: string;
  ts: number;
  blockHeight: number;
  account: string;
  isBuy: boolean;
  memeAmount: bigint;
  linAmount: bigint;
}

interface AccountTx {
  transaction_hash: string;
  tx_block_height: number;
  is_success: boolean;
}

interface FnCall {
  FunctionCall?: { method_name: string; args: string };
}

interface TxReceipt {
  receipt: {
    receipt_id: string;
    receiver_id: string;
    predecessor_id: string;
    block_height: number;
    block_timestamp: number;
    receipt: { Action?: { actions: (FnCall | string)[] } };
  };
  execution_outcome: { outcome: { logs: string[]; status: Record<string, unknown> } };
}

interface TxDetail {
  transaction: { hash: string };
  receipts: TxReceipt[];
}

const SWAP_LOG = /^Swapped (\d+) (\S+) for (\d+) (\S+)$/;

export function defaultTxApi(network: string): string {
  return process.env.FASTNEAR_TX_API ?? (network === "mainnet" ? "https://tx.main.fastnear.com" : "https://tx.test.fastnear.com");
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
  });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return (await r.json()) as T;
}

/** Successful tx hashes touching `accountId` above `sinceHeight`, oldest first. */
async function newTxHashes(txApi: string, accountId: string, sinceHeight: number, maxPages = 6) {
  const out: AccountTx[] = [];
  let maxHeight: number | undefined;
  for (let page = 0; page < maxPages; page++) {
    const body: Record<string, unknown> = { account_id: accountId };
    if (maxHeight !== undefined) body.max_block_height = maxHeight;
    const r = await post<{ account_txs: AccountTx[] }>(`${txApi}/v0/account`, body);
    const rows = r.account_txs ?? [];
    if (rows.length === 0) break;
    let reachedOld = false;
    for (const row of rows) {
      if (row.tx_block_height <= sinceHeight) {
        reachedOld = true;
        continue;
      }
      if (row.is_success) out.push(row);
    }
    if (reachedOld) break;
    const lowest = Math.min(...rows.map((x) => x.tx_block_height));
    if (maxHeight !== undefined && lowest >= maxHeight) break;
    maxHeight = lowest - 1;
  }
  const seen = new Set<string>();
  return out
    .filter((x) => (seen.has(x.transaction_hash) ? false : (seen.add(x.transaction_hash), true)))
    .sort((a, b) => a.tx_block_height - b.tx_block_height);
}

function decodeArgs(b64: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function swapsInTx(tx: TxDetail, o: { tokenId: string; poolId: number; ref: string; linear: string }): RefSwap[] {
  const found: RefSwap[] = [];
  for (const r of tx.receipts ?? []) {
    const rc = r.receipt;
    if (rc.receiver_id !== o.ref) continue;
    const status = r.execution_outcome?.outcome?.status ?? {};
    if ("Failure" in status) continue;
    const calls = rc.receipt?.Action?.actions ?? [];
    const onTransfer = calls
      .map((a) => (typeof a === "object" ? a.FunctionCall : undefined))
      .find((f) => f?.method_name === "ft_on_transfer");
    if (!onTransfer) continue;
    // Ref only executes ft_on_transfer for the token that called it
    if (rc.predecessor_id !== o.tokenId && rc.predecessor_id !== o.linear) continue;
    const args = decodeArgs(onTransfer.args);
    const sender = typeof args?.sender_id === "string" ? args.sender_id : null;
    let actions: { pool_id?: number; token_in?: string; token_out?: string }[] = [];
    try {
      actions = JSON.parse(String(args?.msg ?? "{}")).actions ?? [];
    } catch {
      continue;
    }
    const logs = (r.execution_outcome?.outcome?.logs ?? []).map((l) => SWAP_LOG.exec(l)).filter(Boolean) as RegExpExecArray[];
    // Ref logs one "Swapped" line per action, in action order
    logs.forEach((m, i) => {
      const act = actions[i];
      if (!act || act.pool_id !== o.poolId || !sender) return;
      const [, amtIn, tokIn, amtOut, tokOut] = m;
      if (tokIn === o.linear && tokOut === o.tokenId) {
        found.push({ key: `${tx.transaction.hash}:${rc.receipt_id}:${i}`, ts: Math.floor(rc.block_timestamp / 1e9), blockHeight: rc.block_height, account: sender, isBuy: true, memeAmount: BigInt(amtOut), linAmount: BigInt(amtIn) });
      } else if (tokIn === o.tokenId && tokOut === o.linear) {
        found.push({ key: `${tx.transaction.hash}:${rc.receipt_id}:${i}`, ts: Math.floor(rc.block_timestamp / 1e9), blockHeight: rc.block_height, account: sender, isBuy: false, memeAmount: BigInt(amtIn), linAmount: BigInt(amtOut) });
      }
    });
  }
  return found;
}

/**
 * All swaps on `poolId` for `tokenId` in transactions above `sinceHeight`.
 * Returns the swaps (oldest first) and the highest block height scanned, to use as the next cursor.
 */
export async function fetchRefSwaps(o: {
  txApi: string;
  tokenId: string;
  poolId: number;
  ref: string;
  linear: string;
  sinceHeight: number;
}): Promise<{ swaps: RefSwap[]; cursor: number }> {
  const hashes = await newTxHashes(o.txApi, o.tokenId, o.sinceHeight);
  if (hashes.length === 0) return { swaps: [], cursor: o.sinceHeight };
  const swaps: RefSwap[] = [];
  for (let i = 0; i < hashes.length; i += 20) {
    const chunk = hashes.slice(i, i + 20).map((h) => h.transaction_hash);
    const r = await post<{ transactions: TxDetail[] }>(`${o.txApi}/v0/transactions`, { tx_hashes: chunk });
    for (const tx of r.transactions ?? []) swaps.push(...swapsInTx(tx, o));
  }
  swaps.sort((a, b) => a.blockHeight - b.blockHeight || a.key.localeCompare(b.key));
  return { swaps, cursor: Math.max(o.sinceHeight, ...hashes.map((h) => h.tx_block_height)) };
}

/** Swap value in NEAR (yocto) and price in NEAR per whole token, matching curve-trade units. */
export function swapValue(s: RefSwap, linearPriceYocto: bigint, yocto: bigint) {
  const nearYocto = (s.linAmount * linearPriceYocto) / yocto;
  const price = s.memeAmount > 0n ? Number((nearYocto * 10n ** 18n) / s.memeAmount) / 1e18 / 1e6 : 0;
  return { nearYocto, price };
}
