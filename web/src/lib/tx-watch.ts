/**
 * Watches the chain for transactions the user signs, independently of the wallet.
 *
 * Some wallets never report back after signing: a popup wallet opened in another tab on
 * mobile loses its opener, or an executor waits on a step that never completes. The
 * transaction still lands, but the wallet promise hangs, the NEAR Connect modal stays open
 * and the app never learns the outcome. This watcher finds the signed transactions on-chain
 * (FastNEAR transactions API, then RPC `tx` status), so the app can close the modal and
 * report the real result without a refresh.
 */
import { NETWORK, RPC } from "./near";

const TX_API = NETWORK === "mainnet" ? "https://tx.main.fastnear.com" : "https://tx.test.fastnear.com";

interface AccountTx {
  transaction_hash: string;
  tx_block_height: number;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return (await r.json()) as T;
}

async function rpc<T>(method: string, params: unknown): Promise<T> {
  const j = await post<{ result?: T; error?: { message?: string } }>(RPC, { jsonrpc: "2.0", id: "watch", method, params });
  if (j.error || j.result === undefined) throw new Error(j.error?.message ?? "rpc error");
  return j.result;
}

async function signedTxs(accountId: string): Promise<AccountTx[]> {
  const r = await post<{ account_txs?: AccountTx[] }>(`${TX_API}/v0/account`, {
    account_id: accountId,
    is_signer: true,
    limit: 20,
  });
  return r.account_txs ?? [];
}

export interface TxWatch {
  /** Resolves with the final outcomes once `count` new transactions to `receivers` are found. */
  done: Promise<unknown[]>;
  stop: () => void;
}

/**
 * Snapshot the signer's recent transactions now, then poll for new ones sent to `receivers`.
 * Call before asking the wallet to sign so nothing signed afterwards is missed.
 */
export async function watchSignedTxs(accountId: string, receivers: string[], intervalMs = 3000): Promise<TxWatch> {
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  const [head, before] = await Promise.all([
    rpc<{ header: { height: number } }>("block", { finality: "final" }).then((b) => b.header.height),
    signedTxs(accountId).catch(() => [] as AccountTx[]),
  ]);
  const seen = new Set(before.map((t) => t.transaction_hash));
  const minHeight = head - 5;
  const wanted = receivers.slice();
  const found = new Map<string, unknown>();

  const done = (async () => {
    while (!stopped) {
      await new Promise((r) => setTimeout(r, intervalMs));
      if (stopped) break;
      try {
        const rows = (await signedTxs(accountId)).filter(
          (t) => !seen.has(t.transaction_hash) && !found.has(t.transaction_hash) && t.tx_block_height >= minHeight,
        );
        for (const row of rows) {
          const o = await rpc<{ transaction?: { receiver_id?: string }; final_execution_status?: string }>("tx", {
            tx_hash: row.transaction_hash,
            sender_account_id: accountId,
            wait_until: "EXECUTED_OPTIMISTIC",
          }).catch(() => null);
          if (!o) continue; // not executed yet: retry next round
          seen.add(row.transaction_hash);
          const i = wanted.indexOf(o.transaction?.receiver_id ?? "");
          if (i < 0) continue; // some other transaction this account signed
          wanted.splice(i, 1);
          found.set(row.transaction_hash, o);
        }
        if (wanted.length === 0) return [...found.values()];
      } catch {
        /* indexer or RPC hiccup: keep polling */
      }
    }
    return new Promise<unknown[]>(() => {}); // stopped: never settles
  })();
  return { done, stop };
}

/** Close any NEAR Connect wallet modal still on screen (its promise is abandoned). */
export function closeWalletModals() {
  document.querySelectorAll(".hot-connector-popup").forEach((el) => el.remove());
}
