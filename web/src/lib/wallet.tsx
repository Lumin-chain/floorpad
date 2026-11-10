"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { WalletSelector } from "@near-wallet-selector/core";
import type { WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import { LAUNCHPAD, NETWORK, view } from "./near";

export interface Call {
  method: string;
  args: object;
  /** Tgas */
  gas?: number;
  /** yoctoNEAR */
  deposit?: string | bigint;
}
export interface Tx {
  receiverId: string;
  calls: Call[];
}

interface WalletCtx {
  accountId: string | null;
  ready: boolean;
  signIn: () => void;
  signOut: () => void;
  send: (txs: Tx[]) => Promise<boolean>;
  busy: boolean;
  toast: { kind: "ok" | "err"; text: string } | null;
  setToast: (t: WalletCtx["toast"]) => void;
}

const Ctx = createContext<WalletCtx | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const selector = useRef<WalletSelector | null>(null);
  const modal = useRef<WalletSelectorModal | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<WalletCtx["toast"]>(null);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    (async () => {
      const [{ setupWalletSelector }, { setupModal }, mnw, meteor, here] = await Promise.all([
        import("@near-wallet-selector/core"),
        import("@near-wallet-selector/modal-ui"),
        import("@near-wallet-selector/my-near-wallet"),
        import("@near-wallet-selector/meteor-wallet"),
        import("@near-wallet-selector/here-wallet"),
      ]);
      const s = await setupWalletSelector({
        network: NETWORK,
        modules: [mnw.setupMyNearWallet(), meteor.setupMeteorWallet(), here.setupHereWallet()],
      });
      selector.current = s;
      modal.current = setupModal(s, { contractId: LAUNCHPAD });
      const sync = () => {
        const acc = s.store.getState().accounts.find((a) => a.active) ?? null;
        setAccountId(acc?.accountId ?? null);
      };
      sync();
      const sub = s.store.observable.subscribe(sync);
      unsub = () => sub.unsubscribe();
      setReady(true);
    })().catch((e) => console.error("wallet init failed", e));
    return () => unsub?.();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const signIn = useCallback(() => modal.current?.show(), []);
  const signOut = useCallback(async () => {
    const w = await selector.current?.wallet();
    await w?.signOut();
  }, []);

  const send = useCallback(async (txs: Tx[]) => {
    if (!selector.current) return false;
    if (!accountId) {
      modal.current?.show();
      return false;
    }
    setBusy(true);
    try {
      const wallet = await selector.current.wallet();
      await wallet.signAndSendTransactions({
        transactions: txs.map((tx) => ({
          signerId: accountId,
          receiverId: tx.receiverId,
          actions: tx.calls.map((c) => ({
            type: "FunctionCall" as const,
            params: {
              methodName: c.method,
              args: c.args,
              gas: (BigInt(c.gas ?? 100) * 10n ** 12n).toString(),
              deposit: (c.deposit ?? "0").toString(),
            },
          })),
        })),
      });
      setToast({ kind: "ok", text: "Transaction sent" });
      return true;
    } catch (e) {
      setToast({ kind: "err", text: (e as Error).message ?? "Transaction failed" });
      return false;
    } finally {
      setBusy(false);
    }
  }, [accountId]);

  return (
    <Ctx.Provider value={{ accountId, ready, signIn, signOut, send, busy, toast, setToast }}>
      {children}
    </Ctx.Provider>
  );
}

export function useWallet() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useWallet outside provider");
  return c;
}

/** Poll a view method. `key` changes trigger a refetch. */
export function useView<T>(fetcher: (() => Promise<T>) | null, key: unknown[], intervalMs = 8000) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const f = useRef(fetcher);
  f.current = fetcher;
  const k = JSON.stringify(key);
  const load = useCallback(async () => {
    if (!f.current) return;
    try {
      setData(await f.current());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    setData(undefined);
    load();
    if (!intervalMs) return;
    const t = setInterval(load, intervalMs);
    return () => clearInterval(t);
  }, [k, intervalMs, load]);
  return { data, error, reload: load };
}

/** Returns storage_deposit call if `account` is not registered on `ft`. */
export async function storageCallIfNeeded(ft: string, account: string, amount = "12500000000000000000000"): Promise<Tx | null> {
  const bal = await view<unknown>(ft, "storage_balance_of", { account_id: account }).catch(() => null);
  if (bal) return null;
  return {
    receiverId: ft,
    calls: [{ method: "storage_deposit", args: { account_id: account, registration_only: true }, gas: 10, deposit: amount }],
  };
}
