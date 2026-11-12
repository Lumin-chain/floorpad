import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { defaultTxApi, fetchRefSwaps, swapValue } from "./ref-swaps";

const NETWORK = (process.env.NEXT_PUBLIC_NETWORK ?? "testnet") as "testnet" | "mainnet";
const RPC = process.env.NEXT_PUBLIC_RPC ?? `https://rpc.${NETWORK}.fastnear.com`;
export const LAUNCHPAD = process.env.NEXT_PUBLIC_LAUNCHPAD ?? "lpv45w4s.fpbankmwbbc95z.testnet";
export const LINEAR =
  process.env.NEXT_PUBLIC_LINEAR ?? (NETWORK === "mainnet" ? "linear-protocol.near" : "linear-protocol.testnet");
export const REF =
  process.env.NEXT_PUBLIC_REF ?? (NETWORK === "mainnet" ? "v2.ref-finance.near" : "ref-finance-101.testnet");

export const SIGN_MESSAGE = "Sign in to Floorpad chat. This does not send a transaction or cost gas.";
export const RECIPIENT = LAUNCHPAD;
const YOCTO = 10n ** 24n;

export interface SocialMessage {
  id: number;
  token_id: string;
  account: string;
  text: string;
  reply_to: number | null;
  ts: number;
  is_dev: number;
  holder_pct: number;
  hidden?: number;
}

export interface SocialCall {
  id: number;
  token_id: string;
  account: string;
  thesis: string;
  ts: number;
  mcap_usd: number;
  peak_mcap_usd: number;
  last_mcap_usd: number;
  updated: number;
}

export interface SocialTrade {
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
  /** set for post-graduation Ref swaps: tx hash + receipt + action index (dedupe key) */
  tx?: string;
}

interface PersistedState {
  nextMsgId: number;
  nextCallId: number;
  messages: SocialMessage[];
  calls: SocialCall[];
  trades: SocialTrade[];
  sessions: Record<string, { account: string; expires: number }>;
  challenges: Record<string, number>;
  /** per graduated token: highest block height already scanned for Ref swaps */
  refCursors: Record<string, number>;
}

const now = () => Math.floor(Date.now() / 1000);

// ---- NEP-413 Ed25519 verification ----
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Decode(s: string): Uint8Array {
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error("bad base58");
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n % 256n));
    n /= 256n;
  }
  for (const c of s) {
    if (c !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};
const borshString = (s: string) => {
  const b = Buffer.from(s, "utf8");
  return Buffer.concat([u32(b.length), b]);
};
function nep413Hash(message: string, nonce: Uint8Array, recipient: string, callbackUrl?: string | null): Buffer {
  if (nonce.length !== 32) throw new Error("nonce must be 32 bytes");
  const tag = u32(2 ** 31 + 413);
  const cb = callbackUrl ? Buffer.concat([Buffer.from([1]), borshString(callbackUrl)]) : Buffer.from([0]);
  const payload = Buffer.concat([borshString(message), Buffer.from(nonce), borshString(recipient), cb]);
  return createHash("sha256").update(Buffer.concat([tag, payload])).digest();
}
function ed25519Verify(publicKey: string, data: Buffer, signature: Uint8Array): boolean {
  if (!publicKey.startsWith("ed25519:")) return false;
  const raw = base58Decode(publicKey.slice(8));
  if (raw.length !== 32) return false;
  const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(raw).toString("base64url") }, format: "jwk" });
  return verify(null, data, key, signature);
}
export function verifySignedMessage(p: {
  publicKey: string;
  signature: string;
  message: string;
  nonce: Uint8Array;
  recipient: string;
  callbackUrl?: string | null;
}): boolean {
  const sig = Buffer.from(p.signature, "base64");
  if (sig.length !== 64) return false;
  const variants = p.callbackUrl ? [p.callbackUrl, null] : [null];
  return variants.some((cb) => ed25519Verify(p.publicKey, nep413Hash(p.message, p.nonce, p.recipient, cb), sig));
}

// ---- NEAR RPC reads ----
let rpcId = 0;
async function rpc<T>(method: string, params: unknown): Promise<T> {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  const j = (await r.json()) as { error?: { data?: string; message?: string }; result?: T & { error?: string } };
  if (j.error) throw new Error(j.error.data ?? j.error.message ?? "rpc error");
  if (j.result && (j.result as { error?: string }).error) throw new Error((j.result as { error: string }).error);
  return j.result as T;
}

export async function view<T>(contract: string, method: string, args: object = {}): Promise<T> {
  const r = await rpc<{ result: number[] }>("query", {
    request_type: "call_function",
    finality: "optimistic",
    account_id: contract,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  const text = Buffer.from(r.result).toString("utf8");
  return (text ? JSON.parse(text) : null) as T;
}

export async function isFullAccessKey(accountId: string, publicKey: string): Promise<boolean> {
  try {
    const r = await rpc<{ permission: unknown }>("query", {
      request_type: "view_access_key",
      finality: "final",
      account_id: accountId,
      public_key: publicKey,
    });
    return r.permission === "FullAccess";
  } catch {
    return false;
  }
}

export interface TokenInfo {
  token_id: string;
  creator: string;
  meta: { symbol: string; name: string; icon: string | null };
  grad_stage: string;
  pool_id: number | null;
  fdv_near: string;
  total_supply: string;
  burned: string;
  trade_count?: number;
}

const NEAR_ACCOUNT_RE = /^(([a-z0-9]+[-_])*[a-z0-9]+\.)*([a-z0-9]+[-_])*[a-z0-9]+$/;
export const isValidNearAccount = (s: unknown): s is string =>
  typeof s === "string" && s.length >= 2 && s.length <= 64 && NEAR_ACCOUNT_RE.test(s);

const MAX_CACHE = 2000;
const cache = new Map<string, { at: number; exp: number; v: unknown }>();
async function cached<T>(key: string, ttlMs: number, f: () => Promise<T>): Promise<T> {
  const nowMs = Date.now();
  const c = cache.get(key);
  if (c && nowMs < c.exp) return c.v as T;
  const v = await f();
  if (cache.size >= MAX_CACHE) {
    for (const [k, entry] of cache) {
      if (nowMs >= entry.exp) cache.delete(k);
    }
    while (cache.size >= MAX_CACHE) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }
  cache.set(key, { at: nowMs, exp: nowMs + ttlMs, v });
  return v;
}

export const getToken = (tokenId: string) =>
  cached(`tok:${tokenId}`, 15_000, () => view<TokenInfo | null>(LAUNCHPAD, "get_token", { token_id: tokenId }));

export const getTokens = (limit = 50) =>
  cached("all-tokens", 10_000, () => view<TokenInfo[]>(LAUNCHPAD, "get_tokens", { from_index: 0, limit }));

interface OnChainTrade {
  ts: number;
  account: string;
  is_buy: boolean;
  near: string;
  tokens: string;
  v_near: string;
  v_tokens: string;
}

function calcPrice(vNear: string, vTokens: string): number {
  const vn = BigInt(vNear);
  const vt = BigInt(vTokens);
  if (vt === 0n) return 0;
  return Number((vn * 10n ** 18n) / vt) / 1e18 / 1e6;
}

async function getTradesFrom(tokenId: string, fromIndex: number, limit = 100, tradeCount?: number): Promise<[number, OnChainTrade][]> {
  try {
    return await view<[number, OnChainTrade][]>(LAUNCHPAD, "get_trades_from", { token_id: tokenId, from_index: fromIndex, limit });
  } catch {
    // Fallback for earlier deployed contracts that only expose newest-first `get_trades`
    const recent = await view<OnChainTrade[]>(LAUNCHPAD, "get_trades", { token_id: tokenId, limit }).catch(() => []);
    if (!recent.length) return [];
    const total = tradeCount ?? recent.length;
    const asc = recent
      .map((t, i) => [Math.max(0, total - 1 - i), t] as [number, OnChainTrade])
      .reverse();
    return asc.filter(([idx]) => idx >= fromIndex);
  }
}

const nearUsd = () =>
  cached("near-usd", 60_000, async () => {
    const [micro] = await view<[string, number]>(LAUNCHPAD, "get_near_usd_price");
    return Number(micro) / 1e6;
  });

export async function marketCap(tokenId: string): Promise<{ near: number; usd: number } | null> {
  return cached(`mcap:${tokenId}`, 20_000, async () => {
    const t = await getToken(tokenId);
    if (!t) return null;
    let fdvYocto: bigint;
    if (t.grad_stage === "Graduated" && t.pool_id !== null) {
      const pool = await view<{ token_account_ids: string[]; amounts: string[] }>(REF, "get_pool", { pool_id: t.pool_id });
      const iMeme = pool.token_account_ids.indexOf(tokenId);
      const rMeme = BigInt(pool.amounts[iMeme]);
      const rLin = BigInt(pool.amounts[1 - iMeme]);
      const linPrice = BigInt(await cached("linear-price", 60_000, () => view<string>(LINEAR, "ft_price")));
      const supply = BigInt(t.total_supply) - BigInt(t.burned);
      fdvYocto = rMeme === 0n ? 0n : (rLin * linPrice * supply) / rMeme / YOCTO;
    } else {
      fdvYocto = BigInt(t.fdv_near);
    }
    const near = Number(fdvYocto / 10n ** 18n) / 1e6;
    return { near, usd: near * (await nearUsd()) };
  });
}

export async function holderShare(tokenId: string, account: string): Promise<number> {
  return cached(`hold:${tokenId}:${account}`, 30_000, async () => {
    const [bal, pos, t] = await Promise.all([
      view<string>(tokenId, "ft_balance_of", { account_id: account }).catch(() => "0"),
      view<{ amount: string } | null>(LAUNCHPAD, "get_position", { token_id: tokenId, account_id: account }).catch(() => null),
      getToken(tokenId),
    ]);
    if (!t) return 0;
    const held = BigInt(bal) + BigInt(pos?.amount ?? "0");
    const supply = BigInt(t.total_supply) - BigInt(t.burned);
    return Number((held * 1_000_000n) / supply) / 10_000;
  });
}

// ---- Singleton Store & PubSub across Next.js runtime ----
type Listener = (event: string, data: unknown) => void;

class SocialBackend {
  state: PersistedState = {
    nextMsgId: 1,
    nextCallId: 1,
    messages: [],
    calls: [],
    trades: [],
    sessions: {},
    challenges: {},
    refCursors: {},
  };
  private dbFile: string | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private lastRefScan = new Map<string, number>();
  private refBusy = new Set<string>();
  private indexingBusy = false;
  private lastIndexAt = 0;

  constructor() {
    this.loadFromDisk();
    setInterval(() => this.indexTrades().catch(() => {}), 5_000).unref();
    setInterval(() => this.trackCalls().catch(() => {}), 60_000).unref();
  }

  private resolvePath(): string | null {
    const candidates = [
      process.env.SOCIAL_DB_FILE,
      path.join(process.cwd(), ".floorpad-social.json"),
      path.join("/tmp", "floorpad-social.json"),
    ].filter(Boolean) as string[];

    for (const p of candidates) {
      try {
        const dir = path.dirname(p);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (fs.existsSync(p)) return p;
        fs.writeFileSync(p, JSON.stringify(this.state));
        return p;
      } catch {
        // try next writable location
      }
    }
    return null;
  }

  private loadFromDisk() {
    this.dbFile = this.resolvePath();
    if (!this.dbFile) return;
    try {
      const raw = fs.readFileSync(this.dbFile, "utf8");
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      this.state = {
        nextMsgId: parsed.nextMsgId ?? 1,
        nextCallId: parsed.nextCallId ?? 1,
        messages: parsed.messages ?? [],
        calls: parsed.calls ?? [],
        // drop trades the old reserve-diff indexer guessed ("ref-finance.near", poll-time stamps);
        // the Ref swap backfill re-reads them exactly from the chain
        trades: (parsed.trades ?? []).filter((t) => !(t.account === "ref-finance.near" && !t.tx)),
        sessions: parsed.sessions ?? {},
        challenges: parsed.challenges ?? {},
        refCursors: parsed.refCursors ?? {},
      };
    } catch {
      // start fresh
    }
  }

  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private persist() {
    if (!this.dbFile || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (!this.dbFile) return;
      try {
        fs.writeFileSync(this.dbFile, JSON.stringify(this.state));
      } catch {
        // ignore disk write failures
      }
    }, 300);
  }

  subscribe(topic: string, fn: Listener): () => void {
    let set = this.listeners.get(topic);
    if (!set) {
      set = new Set();
      this.listeners.set(topic, set);
    }
    set.add(fn);
    return () => {
      set?.delete(fn);
    };
  }

  publish(topic: string, event: string, data: unknown) {
    const set = this.listeners.get(topic);
    if (!set) return;
    for (const fn of set) fn(event, data);
  }

  addChallenge(nonce: string) {
    const cutoff = now() - 600;
    for (const [k, ts] of Object.entries(this.state.challenges)) {
      if (ts < cutoff) delete this.state.challenges[k];
    }
    const keys = Object.keys(this.state.challenges);
    if (keys.length > 1000) {
      for (const k of keys.slice(0, keys.length - 1000)) delete this.state.challenges[k];
    }
    this.state.challenges[nonce] = now();
    this.persist();
  }

  takeChallenge(nonce: string): boolean {
    const ts = this.state.challenges[nonce];
    if (!ts) return false;
    delete this.state.challenges[nonce];
    this.persist();
    return now() - ts <= 600;
  }

  addSession(token: string, account: string, days = 14) {
    const cur = now();
    for (const [k, s] of Object.entries(this.state.sessions)) {
      if (s.expires <= cur) delete this.state.sessions[k];
    }
    this.state.sessions[token] = { account, expires: cur + days * 86400 };
    this.persist();
  }

  sessionAccount(token: string): string | null {
    const s = this.state.sessions[token];
    if (!s || s.expires <= now()) return null;
    return s.account;
  }

  addChallengeAndIssue(): { nonce: string; message: string; recipient: string } {
    const nonce = randomBytes(32).toString("base64");
    this.addChallenge(nonce);
    return { nonce, message: SIGN_MESSAGE, recipient: RECIPIENT };
  }

  messages(tokenId: string, before: number | null, limit: number): SocialMessage[] {
    return this.state.messages
      .filter((m) => m.token_id === tokenId && !m.hidden && m.id < (before ?? Number.MAX_SAFE_INTEGER))
      .slice(-limit);
  }

  lastMessageTs(tokenId: string, account: string): number {
    let max = 0;
    for (const m of this.state.messages) {
      if (m.token_id === tokenId && m.account === account && m.ts > max) max = m.ts;
    }
    return max;
  }

  addMessage(m: Omit<SocialMessage, "id">): SocialMessage {
    const saved: SocialMessage = { ...m, id: this.state.nextMsgId++ };
    this.state.messages.push(saved);
    if (this.state.messages.length > 5000) this.state.messages.splice(0, 500);
    this.persist();
    this.publish(`token:${m.token_id}`, "message", saved);
    return saved;
  }

  hideMessage(id: number, account: string, tokenCreator: string): boolean {
    const m = this.state.messages.find((x) => x.id === id);
    if (!m) return false;
    if (account !== tokenCreator && account !== m.account) return false;
    m.hidden = 1;
    this.persist();
    this.publish(`token:${m.token_id}`, "hide", { id });
    return true;
  }

  messageCounts(since: number): { token_id: string; n: number }[] {
    const map = new Map<string, number>();
    for (const m of this.state.messages) {
      if (!m.hidden && m.ts > since) {
        map.set(m.token_id, (map.get(m.token_id) ?? 0) + 1);
      }
    }
    return Array.from(map.entries()).map(([token_id, n]) => ({ token_id, n }));
  }

  addCall(c: Omit<SocialCall, "id">): SocialCall {
    const call: SocialCall = { ...c, id: this.state.nextCallId++ };
    this.state.calls.push(call);
    this.persist();
    return call;
  }

  lastCallTs(tokenId: string, account: string): number {
    let max = 0;
    for (const c of this.state.calls) {
      if (c.token_id === tokenId && c.account === account && c.ts > max) max = c.ts;
    }
    return max;
  }

  callsForToken(tokenId: string, limit: number): SocialCall[] {
    return this.state.calls.filter((c) => c.token_id === tokenId).slice(-limit).reverse();
  }

  recentCalls(limit: number): SocialCall[] {
    return this.state.calls.slice(-limit).reverse();
  }

  leaderboard(since: number, limit: number) {
    const map = new Map<string, SocialCall[]>();
    for (const c of this.state.calls) {
      if (c.ts > since && c.mcap_usd > 0) {
        const list = map.get(c.account) ?? [];
        list.push(c);
        map.set(c.account, list);
      }
    }
    const rows = Array.from(map.entries()).map(([account, calls]) => {
      const xs = calls.map((c) => c.peak_mcap_usd / c.mcap_usd);
      return {
        account,
        calls: calls.length,
        avg_peak_x: xs.reduce((a, b) => a + b, 0) / xs.length,
        best_x: Math.max(...xs),
        hits_2x: xs.filter((x) => x >= 2).length,
      };
    });
    rows.sort((a, b) => b.avg_peak_x - a.avg_peak_x);
    return rows.slice(0, limit);
  }

  addTrade(t: SocialTrade): boolean {
    const exists = this.state.trades.some((x) => x.token_id === t.token_id && (x.id === t.id || (!!t.tx && x.tx === t.tx)));
    if (exists) return false;
    this.state.trades.push(t);
    if (this.state.trades.length > 5000) this.state.trades.splice(0, 500);
    this.persist();
    return true;
  }

  lastTradeIndex(tokenId: string): number {
    let max = -1;
    for (const t of this.state.trades) {
      if (t.token_id === tokenId && t.id > max) max = t.id;
    }
    return max;
  }

  lastCurveTradeIndex(tokenId: string): number {
    let max = -1;
    for (const t of this.state.trades) {
      if (t.token_id === tokenId && t.id < 1_000_000_000 && t.id > max) max = t.id;
    }
    return max;
  }

  hasRecentSimilarTrade(tokenId: string, isBuy: number, tokens: string, withinSecs = 25): boolean {
    const cutoff = now() - withinSecs;
    return this.state.trades.some(
      (t) => t.token_id === tokenId && t.is_buy === isBuy && t.tokens === tokens && t.ts >= cutoff,
    );
  }

  tradesForToken(tokenId: string, limit: number): SocialTrade[] {
    return this.state.trades
      .filter((t) => t.token_id === tokenId)
      .sort((a, b) => b.ts - a.ts || b.id - a.id)
      .slice(0, limit);
  }

  recentGlobalTrades(limit: number): SocialTrade[] {
    return [...this.state.trades]
      .sort((a, b) => b.ts - a.ts || b.id - a.id)
      .slice(0, limit);
  }

  candles(tokenId: string, tfSecs: number, limit: number) {
    const tf = Math.max(10, tfSecs);
    // every trade counts; slice(-limit) below keeps the most recent buckets
    const rows = this.state.trades
      .filter((t) => t.token_id === tokenId && t.price > 0)
      .sort((a, b) => a.ts - b.ts || a.id - b.id);
    if (rows.length === 0) return [];
    const map = new Map<number, { open: number; high: number; low: number; close: number; volume: number; trades: number }>();
    for (const row of rows) {
      const bucket = Math.floor(row.ts / tf) * tf;
      const p = row.price;
      const volNear = Number(BigInt(row.near) / 10n ** 18n) / 1e6;
      const c = map.get(bucket);
      if (!c) {
        map.set(bucket, { open: p, high: p, low: p, close: p, volume: volNear, trades: 1 });
      } else {
        c.high = Math.max(c.high, p);
        c.low = Math.min(c.low, p);
        c.close = p;
        c.volume += volNear;
        c.trades += 1;
      }
    }
    return Array.from(map.entries())
      .map(([time, c]) => ({ time, ...c }))
      .sort((a, b) => a.time - b.time)
      .slice(-limit);
  }

  async ensureIndexedRecent() {
    if (Date.now() - this.lastIndexAt > 4000) {
      await this.indexTrades();
    }
  }

  private lastNudgeByToken = new Map<string, number>();

  async indexTokenTrades(tok: TokenInfo, bypassDebounce = false) {
    const last = this.lastNudgeByToken.get(tok.token_id) ?? 0;
    if (!bypassDebounce && Date.now() - last < 1500) return;
    this.lastNudgeByToken.set(tok.token_id, Date.now());
    const lastCurve = this.lastCurveTradeIndex(tok.token_id);
    if (tok.trade_count === undefined || lastCurve + 1 < tok.trade_count) {
      const fromIdx = Math.max(0, lastCurve + 1);
      const trades = await getTradesFrom(tok.token_id, fromIdx, 50, tok.trade_count).catch(() => []);
      for (const [idx, tr] of trades) {
        const isBuyInt = tr.is_buy ? 1 : 0;
        const duplicate = this.hasRecentSimilarTrade(tok.token_id, isBuyInt, tr.tokens, 25);
        const stored: SocialTrade = {
          token_id: tok.token_id,
          id: idx,
          ts: tr.ts,
          account: tr.account,
          is_buy: isBuyInt,
          near: tr.near,
          tokens: tr.tokens,
          price: calcPrice(tr.v_near, tr.v_tokens),
          v_near: tr.v_near,
          v_tokens: tr.v_tokens,
        };
        const added = this.addTrade(stored);
        if (added && !duplicate) {
          const payload = { ...stored, symbol: tok.meta.symbol, icon: tok.meta.icon };
          this.publish(`token:${tok.token_id}`, "trade", payload);
          this.publish("global", "trade", payload);
        }
      }
    }
    if (tok.grad_stage === "Graduated" && tok.pool_id !== null) {
      // background loop (bypassDebounce) stays on the 12s throttle; a post-trade nudge scans now
      await this.indexRefSwaps(tok, !bypassDebounce).catch(() => {});
    }
  }

  /**
   * Post-graduation trades, read from the chain (see ref-swaps.ts): every swap on the token's
   * locked Ref pool with its real trader, amounts and block time. Cursor is persisted, so a
   * restart resumes where it left off and the first run backfills the whole pool history.
   */
  async indexRefSwaps(tok: TokenInfo, force = false) {
    if (tok.pool_id === null || this.refBusy.has(tok.token_id)) return;
    const last = this.lastRefScan.get(tok.token_id) ?? 0;
    if (!force && Date.now() - last < 12_000) return;
    this.refBusy.add(tok.token_id);
    this.lastRefScan.set(tok.token_id, Date.now());
    try {
      const since = this.state.refCursors[tok.token_id] ?? 0;
      const { swaps, cursor } = await fetchRefSwaps({
        txApi: defaultTxApi(NETWORK),
        tokenId: tok.token_id,
        poolId: tok.pool_id,
        ref: REF,
        linear: LINEAR,
        sinceHeight: since,
      });
      if (swaps.length) {
        const linPrice = BigInt(
          await cached("linear-price", 60_000, () => view<string>(LINEAR, "ft_price").catch(() => YOCTO.toString())),
        );
        for (const sw of swaps) {
          const { nearYocto, price } = swapValue(sw, linPrice, YOCTO);
          const stored: SocialTrade = {
            token_id: tok.token_id,
            id: Math.max(1_000_000_000, this.lastTradeIndex(tok.token_id) + 1),
            ts: sw.ts,
            account: sw.account,
            is_buy: sw.isBuy ? 1 : 0,
            near: nearYocto.toString(),
            tokens: sw.memeAmount.toString(),
            price,
            v_near: "0",
            v_tokens: "0",
            tx: sw.key,
          };
          if (this.addTrade(stored)) {
            const payload = { ...stored, symbol: tok.meta.symbol, icon: tok.meta.icon };
            this.publish(`token:${tok.token_id}`, "trade", payload);
            this.publish("global", "trade", payload);
          }
        }
      }
      if (cursor > since) {
        this.state.refCursors[tok.token_id] = cursor;
        this.persist();
      }
    } finally {
      this.refBusy.delete(tok.token_id);
    }
  }

  async indexTrades() {
    if (this.indexingBusy) return;
    this.indexingBusy = true;
    this.lastIndexAt = Date.now();
    try {
      const tokens = await getTokens(50).catch(() => []);
      for (const tok of tokens) {
        await this.indexTokenTrades(tok, true);
      }
    } finally {
      this.indexingBusy = false;
    }
  }

  private async trackCalls() {
    const since = now() - 30 * 86400;
    const tokenIds = Array.from(new Set(this.state.calls.filter((c) => c.ts > since).map((c) => c.token_id)));
    for (const tokenId of tokenIds) {
      const mc = await marketCap(tokenId).catch(() => null);
      if (mc && mc.usd > 0) {
        for (const c of this.state.calls) {
          if (c.token_id === tokenId && c.ts > since) {
            c.last_mcap_usd = mc.usd;
            c.peak_mcap_usd = Math.max(c.peak_mcap_usd, mc.usd);
            c.updated = now();
          }
        }
        this.persist();
      }
    }
  }
}

const g = globalThis as unknown as { __floorpadSocialBackend?: SocialBackend };
export function getSocialBackend(): SocialBackend {
  if (!g.__floorpadSocialBackend) {
    g.__floorpadSocialBackend = new SocialBackend();
  }
  return g.__floorpadSocialBackend;
}

