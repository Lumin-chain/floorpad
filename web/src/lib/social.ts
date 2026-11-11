"use client";

import { useEffect, useRef } from "react";

const RAW_SOCIAL_API = process.env.NEXT_PUBLIC_SOCIAL_API;
export const SOCIAL_API =
  RAW_SOCIAL_API && !RAW_SOCIAL_API.includes("localhost:8787")
    ? RAW_SOCIAL_API
    : typeof window !== "undefined" &&
        (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") &&
        RAW_SOCIAL_API
      ? RAW_SOCIAL_API
      : "/api/social";

/** True when either an external Social API or the built-in /api/social route is active. */
export function isSocialConfigured(): boolean {
  return true;
}
const SESSION_KEY = "floorpad.chat.session";
const PENDING_KEY = "floorpad.chat.pending";

export interface ChatMessage {
  id: number;
  token_id: string;
  account: string;
  text: string;
  reply_to: number | null;
  ts: number;
  is_dev: number;
  holder_pct: number;
}
export interface Callout {
  id: number;
  token_id: string;
  account: string;
  thesis: string;
  ts: number;
  mcap_usd: number;
  peak_mcap_usd: number;
  last_mcap_usd: number;
  x_now: number;
  x_peak: number;
  symbol?: string;
  icon?: string | null;
}
export interface Caller {
  account: string;
  calls: number;
  avg_peak_x: number;
  best_x: number;
  hits_2x: number;
}

export interface Session {
  token: string;
  accountId: string;
}

export function getSession(accountId: string | null): Session | null {
  if (typeof window === "undefined" || !accountId) return null;
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null") as Session | null;
    return s && s.accountId === accountId ? s : null;
  } catch {
    return null;
  }
}
export const clearSession = () => localStorage.removeItem(SESSION_KEY);

export async function api<T>(path: string, init: RequestInit & { session?: Session | null } = {}): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.session) headers.authorization = `Bearer ${init.session.token}`;
  const r = await fetch(`${SOCIAL_API}${path}`, { ...init, headers: { ...headers, ...(init.headers as object) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401) clearSession();
    throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
  }
  return j as T;
}

interface Signed {
  accountId: string;
  publicKey: string;
  signature: string;
}

async function finish(signed: Signed, nonce: string, callbackUrl?: string): Promise<Session> {
  const s = await api<Session>("/auth/verify", { method: "POST", body: JSON.stringify({ ...signed, nonce, callbackUrl }) });
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  return s;
}

/**
 * One-time NEP-413 sign-in (no transaction, no gas). Injected wallets return the
 * signature directly; redirect wallets (MyNearWallet) come back with it in the URL hash.
 */
export async function signInChat(
  signMessage: (p: { message: string; recipient: string; nonce: Uint8Array; callbackUrl: string }) => Promise<Signed | void>,
): Promise<Session | null> {
  const ch = await api<{ nonce: string; message: string; recipient: string }>("/auth/challenge", { method: "POST" });
  const callbackUrl = window.location.href.split("#")[0];
  localStorage.setItem(PENDING_KEY, JSON.stringify({ nonce: ch.nonce, callbackUrl }));
  const nonce = Uint8Array.from(atob(ch.nonce), (c) => c.charCodeAt(0));
  const signed = await signMessage({ message: ch.message, recipient: ch.recipient, nonce, callbackUrl });
  if (!signed) return null; // redirecting
  localStorage.removeItem(PENDING_KEY);
  return finish(signed, ch.nonce, callbackUrl);
}

/** Completes a redirect-wallet sign-in if the URL hash carries a signature. */
export async function completeRedirectSignIn(): Promise<Session | null> {
  if (typeof window === "undefined" || !window.location.hash.includes("signature=")) return null;
  const h = new URLSearchParams(window.location.hash.slice(1));
  let pending: { nonce: string; callbackUrl: string } | null = null;
  try {
    pending = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "null") as { nonce: string; callbackUrl: string } | null;
  } catch {
    pending = null;
  }
  history.replaceState(null, "", window.location.pathname + window.location.search);
  const accountId = h.get("accountId");
  const publicKey = h.get("publicKey");
  const signature = h.get("signature");
  if (!pending || !accountId || !publicKey || !signature) return null;
  localStorage.removeItem(PENDING_KEY);
  return finish({ accountId, publicKey, signature }, pending.nonce, pending.callbackUrl);
}

/** Subscribe to a server-sent-events topic ("global" or "token:<id>"). */
export function useStream(topic: string | null, handlers: Record<string, (data: unknown) => void>) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    if (!topic) return;
    const es = new EventSource(`${SOCIAL_API}/stream?topic=${encodeURIComponent(topic)}`);
    const names = Object.keys(ref.current);
    const listeners = names.map((n) => {
      const l = (e: MessageEvent) => {
        try {
          ref.current[n]?.(JSON.parse(e.data));
        } catch {
          // ignore malformed SSE payload
        }
      };
      es.addEventListener(n, l);
      return [n, l] as const;
    });
    return () => {
      listeners.forEach(([n, l]) => es.removeEventListener(n, l));
      es.close();
    };
  }, [topic]);
}

export function fmtUsd(v: number): string {
  if (!isFinite(v)) return "–";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
  return `$${v.toFixed(v < 10 ? 2 : 0)}`;
}
export const fmtX = (x: number) => (x >= 10 ? `${x.toFixed(0)}x` : `${x.toFixed(2)}x`);

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades: number;
}

export interface IndexedTrade {
  id: number;
  token_id: string;
  ts: number;
  account: string;
  is_buy: number;
  near: string;
  tokens: string;
  price: number;
  v_near: string;
  v_tokens: string;
}

export interface GlobalTrade extends IndexedTrade {
  symbol?: string;
  icon?: string | null;
}

export const getCandles = (tokenId: string, tf = "5m", limit = 100) =>
  api<Candle[]>(`/tokens/${tokenId}/candles?tf=${tf}&limit=${limit}`).catch(() => []);

export const getIndexedTrades = (tokenId: string, limit = 50) =>
  api<IndexedTrade[]>(`/tokens/${tokenId}/trades?limit=${limit}`).catch(() => []);

export const getGlobalTrades = (limit = 20) =>
  api<GlobalTrade[]>(`/trades?limit=${limit}`).catch(() => []);

export const postTrade = (
  tokenId: string,
  trade: {
    account: string;
    is_buy: boolean;
    near: string;
    tokens: string;
    price: number;
    v_near?: string;
    v_tokens?: string;
  },
) =>
  api<IndexedTrade>(`/tokens/${tokenId}/trades`, {
    method: "POST",
    body: JSON.stringify(trade),
  });
