"use client";

/**
 * Wallet layer on NEAR Connect (@hot-labs/near-connect), the connector NEAR-DevHub's
 * Trezu uses. Wallets run in sandboxed executors (HOT, Meteor, Intear, MyNearWallet,
 * Nightly, Ledger, ...) and are discovered from a live manifest, so new wallets appear
 * without an app update. WalletConnect is enabled when a project id is configured.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { NearConnector } from "@hot-labs/near-connect";
import { NETWORK, RPC, view, viewAccount } from "./near";
import { clearSession, completeRedirectSignIn, getSession, signInChat, type Session } from "./social";

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
  nearBalance: string;
  reloadNearBalance: () => void;
  ready: boolean;
  signIn: () => void;
  signOut: () => void;
  send: (txs: Tx[]) => Promise<boolean>;
  busy: boolean;
  toast: { kind: "ok" | "err"; text: string } | null;
  setToast: (t: WalletCtx["toast"]) => void;
  /** Chat/callouts session (NEP-413 sign-in, no gas). */
  chat: Session | null;
  chatSignIn: () => Promise<void>;
}

const Ctx = createContext<WalletCtx | null>(null);
const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

async function walletConnectClient() {
  if (!WC_PROJECT_ID) return undefined;
  const { default: SignClient } = await import("@walletconnect/sign-client");
  return SignClient.init({
    projectId: WC_PROJECT_ID,
    metadata: {
      name: "Floorpad",
      description: "Meme launches with a floor that only goes up",
      url: typeof window !== "undefined" ? window.location.origin : "https://floorpad.app",
      icons: ["/brand/icon-192.png"],
    },
  });
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const connector = useRef<NearConnector | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<WalletCtx["toast"]>(null);
  const [chat, setChat] = useState<Session | null>(null);
  const [nearBalance, setNearBalance] = useState("0");

  const reloadNearBalance = useCallback(() => {
    if (!accountId) {
      setNearBalance("0");
      return;
    }
    viewAccount(accountId).then((a) => {
      if (a?.amount) setNearBalance(a.amount);
    }).catch(() => {});
  }, [accountId]);

  useEffect(() => {
    reloadNearBalance();
    if (!accountId) return;
    const h = setInterval(reloadNearBalance, 8000);
    return () => clearInterval(h);
  }, [accountId, reloadNearBalance]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { NearConnector } = await import("@hot-labs/near-connect");
      const wc = walletConnectClient();
      const c = new NearConnector({
        network: NETWORK,
        providers: { [NETWORK]: [RPC] },
        walletConnect: WC_PROJECT_ID ? (wc as never) : undefined,
        footerBranding: {
          icon: "/brand/icon-192.png",
          link: "https://wallet.near.org",
          linkText: "Need a NEAR wallet?",
          heading: "Floorpad",
        },
      });
      c.on("wallet:signIn", (e) => setAccountId(e.accounts[0]?.accountId ?? null));
      c.on("wallet:signOut", () => {
        setAccountId(null);
        clearSession();
        setChat(null);
      });
      connector.current = c;
      try {
        const { accounts } = await c.getConnectedWallet();
        if (!cancelled) setAccountId(accounts[0]?.accountId ?? null);
      } catch {
        /* not connected yet */
      }
      if (!cancelled) setReady(true);
    })().catch((e) => console.error("wallet init failed", e));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => setChat(getSession(accountId)), [accountId]);
  useEffect(() => {
    if (!ready) return;
    completeRedirectSignIn()
      .then((s) => s && setChat(s))
      .catch((e) => setToast({ kind: "err", text: `Chat sign-in failed: ${(e as Error).message}` }));
  }, [ready]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const signIn = useCallback(async () => {
    try {
      await connector.current?.connect();
    } catch (e) {
      const msg = (e as Error)?.message;
      if (msg && !/reject|cancel|closed/i.test(msg)) setToast({ kind: "err", text: msg });
    }
  }, []);

  const signOut = useCallback(async () => {
    clearSession();
    setChat(null);
    await connector.current?.disconnect().catch(() => {});
    setAccountId(null);
  }, []);

  const send = useCallback(
    async (txs: Tx[]) => {
      if (!connector.current) return false;
      if (!accountId) {
        signIn();
        return false;
      }
      setBusy(true);
      try {
        const wallet = await connector.current.wallet();
        await wallet.signAndSendTransactions({
          network: NETWORK,
          signerId: accountId,
          transactions: txs.map((tx) => ({
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
        setTimeout(reloadNearBalance, 1500);
        return true;
      } catch (e) {
        setToast({ kind: "err", text: (e as Error)?.message ?? "Transaction failed" });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [accountId, signIn, reloadNearBalance],
  );

  const chatSignIn = useCallback(async () => {
    if (!connector.current || !accountId) {
      signIn();
      return;
    }
    try {
      const wallet = await connector.current.wallet();
      const s = await signInChat(async (p) => {
        const r = await wallet.signMessage({ message: p.message, recipient: p.recipient, nonce: p.nonce, network: NETWORK, signerId: accountId });
        return { accountId: r.accountId, publicKey: r.publicKey, signature: r.signature };
      });
      if (s) {
        setChat(s);
        setToast({ kind: "ok", text: "Signed in to chat" });
      }
    } catch (e) {
      setToast({ kind: "err", text: (e as Error)?.message ?? "Sign-in failed" });
    }
  }, [accountId, signIn]);

  return (
    <Ctx.Provider
      value={{
        accountId,
        nearBalance,
        reloadNearBalance,
        ready,
        signIn,
        signOut,
        send,
        busy,
        toast,
        setToast,
        chat,
        chatSignIn,
      }}
    >
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
