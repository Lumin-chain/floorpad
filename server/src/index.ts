/**
 * Floorpad social API: per-token live chat + callouts with tracked performance.
 *
 * Auth: the wallet signs a NEP-413 message once (no transaction, no gas); the
 * server checks it is a full-access key of the account and issues a session.
 * Live updates use Server-Sent Events. Storage is node:sqlite. No runtime deps.
 */
import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  calcPrice,
  cached,
  env,
  getToken,
  getTokens,
  getTradesFrom,
  holderShare,
  isFullAccessKey,
  isValidNearAccount,
  LAUNCHPAD,
  LINEAR,
  marketCap,
  REF,
  view,
} from "./chain.ts";
import { verifySignedMessage } from "./nep413.ts";
import { defaultTxApi, fetchRefSwaps, swapValue } from "./ref-swaps.ts";
import { openStore, type Call, type Message, type StoredTrade } from "./store.ts";

try {
  process.loadEnvFile?.(".env");
} catch {
  /* optional */
}

const PORT = Number(env("PORT", "8787"));
const ORIGINS = env("CORS_ORIGINS", "*").split(",").map((s) => s.trim());
const ADMINS = new Set(env("ADMINS", "").split(",").map((s) => s.trim()).filter(Boolean));
const AGENT_SECRET = process.env.AGENT_SECRET ?? "";
const store = openStore(env("DB_PATH", "./floorpad-social.db"));

const SIGN_MESSAGE = "Sign in to Floorpad chat. This does not send a transaction or cost gas.";
const RECIPIENT = LAUNCHPAD;
const MAX_TEXT = 500;
const MSG_COOLDOWN = 2; // seconds between messages per account per token
const CALL_COOLDOWN = 24 * 3600; // one callout per account per token per day
const CALL_WINDOW = 30 * 86400; // calls are tracked for 30 days

// ---------------- SSE ----------------
type Client = { res: http.ServerResponse; topic: string };
const clients = new Set<Client>();
function publish(topic: string, event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) if (c.topic === topic) c.res.write(payload);
}
setInterval(() => {
  for (const c of clients) c.res.write(": ping\n\n");
}, 25_000).unref();

// ---------------- helpers ----------------
class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function body<T>(req: http.IncomingMessage): Promise<T> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 16_384) throw new HttpError(413, "body too large");
  }
  try {
    return (raw ? JSON.parse(raw) : {}) as T;
  } catch {
    throw new HttpError(400, "invalid json");
  }
}

function auth(req: http.IncomingMessage): string {
  const h = req.headers.authorization ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  const account = token ? store.sessionAccount(token) : null;
  if (!account) throw new HttpError(401, "sign in required");
  return account;
}

const now = () => Math.floor(Date.now() / 1000);
const clean = (s: unknown, max: number) =>
  String(s ?? "")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);

function decorate(c: Call) {
  return { ...c, x_now: c.mcap_usd > 0 ? c.last_mcap_usd / c.mcap_usd : 0, x_peak: c.mcap_usd > 0 ? c.peak_mcap_usd / c.mcap_usd : 0 };
}

const MAX_SSE_CLIENTS = 500;
const RATE_MAX_KEYS = 10_000;
const rateBuckets = new Map<string, { resetAt: number; count: number }>();

function clientIp(req: http.IncomingMessage): string {
  const xff = req.headers["x-forwarded-for"];
  const raw = Array.isArray(xff) ? xff[0] : xff;
  return (raw?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown").slice(0, 64);
}

function checkRate(req: http.IncomingMessage, bucket: string, maxPerMin: number) {
  const key = `${bucket}:${clientIp(req)}`;
  const nowMs = Date.now();
  const entry = rateBuckets.get(key);
  if (!entry || nowMs >= entry.resetAt) {
    if (rateBuckets.size >= RATE_MAX_KEYS) {
      for (const [k, v] of rateBuckets) {
        if (nowMs >= v.resetAt) rateBuckets.delete(k);
      }
      if (rateBuckets.size >= RATE_MAX_KEYS) rateBuckets.clear();
    }
    rateBuckets.set(key, { resetAt: nowMs + 60_000, count: 1 });
    return;
  }
  entry.count += 1;
  if (entry.count > maxPerMin) throw new HttpError(429, "too many requests");
}

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function isValidTopic(topic: string): boolean {
  if (topic === "global") return true;
  if (topic.startsWith("token:")) return isValidNearAccount(topic.slice(6));
  return false;
}

async function requireToken(tokenId: string) {
  if (!isValidNearAccount(tokenId)) throw new HttpError(400, "invalid token id");
  const t = await getToken(tokenId).catch(() => null);
  if (!t) throw new HttpError(404, "unknown token");
  return t;
}

// ---------------- routes ----------------
type Handler = (req: http.IncomingMessage, res: http.ServerResponse, p: Record<string, string>, q: URLSearchParams) => Promise<unknown>;
const routes: [string, RegExp, Handler][] = [];
const route = (method: string, path: string, h: Handler) => {
  const re = new RegExp("^" + path.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$");
  routes.push([method, re, h]);
};

route("GET", "/health", async () => ({ ok: true }));

route("POST", "/auth/challenge", async (req) => {
  checkRate(req, "auth", 20);
  const nonce = randomBytes(32).toString("base64");
  store.addChallenge(nonce);
  return { nonce, message: SIGN_MESSAGE, recipient: RECIPIENT };
});

route("POST", "/auth/verify", async (req) => {
  checkRate(req, "auth", 20);
  const b = await body<{ accountId: string; publicKey: string; signature: string; nonce: string; callbackUrl?: string }>(req);
  if (!b.accountId || !b.publicKey || !b.signature || !b.nonce) throw new HttpError(400, "missing fields");
  if (!isValidNearAccount(b.accountId)) throw new HttpError(400, "invalid account id");
  if (typeof b.publicKey !== "string" || typeof b.signature !== "string" || typeof b.nonce !== "string") {
    throw new HttpError(400, "invalid fields");
  }
  if (!store.takeChallenge(b.nonce)) throw new HttpError(400, "unknown or expired challenge");
  const ok = verifySignedMessage({
    publicKey: b.publicKey,
    signature: b.signature,
    message: SIGN_MESSAGE,
    nonce: Buffer.from(b.nonce, "base64"),
    recipient: RECIPIENT,
    callbackUrl: typeof b.callbackUrl === "string" && b.callbackUrl.length <= 512 ? b.callbackUrl : null,
  });
  if (!ok) throw new HttpError(401, "bad signature");
  if (!(await isFullAccessKey(b.accountId, b.publicKey))) throw new HttpError(401, "key is not a full-access key of this account");
  const token = randomBytes(32).toString("base64url");
  store.addSession(token, b.accountId);
  return { token, accountId: b.accountId };
});

route("GET", "/me", async (req) => ({ accountId: auth(req) }));

route("GET", "/tokens/:id/messages", async (_req, _res, p, q) => {
  if (!isValidNearAccount(p.id)) throw new HttpError(400, "invalid token id");
  const before = q.get("before") ? clampInt(q.get("before"), 1, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER) : null;
  return store.messages(p.id, before, clampInt(q.get("limit"), 1, 100, 50));
});

route("POST", "/tokens/:id/messages", async (req, _res, p) => {
  checkRate(req, "write", 40);
  const account = auth(req);
  const t = await requireToken(p.id);
  const b = await body<{ text: string; replyTo?: number }>(req);
  const text = clean(b.text, MAX_TEXT);
  if (!text) throw new HttpError(400, "empty message");
  if (now() - store.lastMessageTs(p.id, account) < MSG_COOLDOWN) throw new HttpError(429, "slow down");
  let replyTo: number | null = null;
  if (b.replyTo !== undefined && b.replyTo !== null) {
    const rid = Number(b.replyTo);
    if (!Number.isSafeInteger(rid) || rid <= 0) throw new HttpError(400, "invalid reply target");
    const target = store.message(rid);
    if (!target || target.hidden || target.token_id !== p.id) throw new HttpError(400, "invalid reply target");
    replyTo = rid;
  }
  const m: Omit<Message, "id"> = {
    token_id: p.id,
    account,
    text,
    reply_to: replyTo,
    ts: now(),
    is_dev: account === t.creator ? 1 : 0,
    holder_pct: await holderShare(p.id, account).catch(() => 0),
  };
  const saved = store.addMessage(m);
  publish(`token:${p.id}`, "message", saved);
  return saved;
});

route("POST", "/tokens/:id/agent-reply", async (req, _res, p) => {
  if (!AGENT_SECRET) throw new HttpError(503, "agent bridge not configured");
  const hdr = String(req.headers["x-agent-secret"] ?? "");
  const a = Buffer.from(hdr);
  const b = Buffer.from(AGENT_SECRET);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(403, "forbidden");
  const t = await requireToken(p.id);
  const bodyJson = await body<{ text: string; replyTo?: number }>(req);
  const text = clean(bodyJson.text, MAX_TEXT);
  if (!text) throw new HttpError(400, "empty message");
  let replyTo: number | null = null;
  if (bodyJson.replyTo !== undefined && bodyJson.replyTo !== null) {
    const rid = Number(bodyJson.replyTo);
    if (Number.isSafeInteger(rid) && rid > 0) {
      const target = store.message(rid);
      if (target && !target.hidden && target.token_id === p.id) replyTo = rid;
    }
  }
  const saved = store.addMessage({
    token_id: p.id,
    account: t.agent_account || "agent.floorpad.near",
    text,
    reply_to: replyTo,
    ts: now(),
    is_dev: 0,
    holder_pct: 0,
  });
  publish(`token:${p.id}`, "message", saved);
  return saved;
});

route("DELETE", "/messages/:id", async (req, _res, p) => {
  checkRate(req, "write", 40);
  const account = auth(req);
  const msgId = clampInt(p.id, 1, Number.MAX_SAFE_INTEGER, 0);
  if (!msgId) throw new HttpError(400, "invalid message id");
  const m = store.message(msgId);
  if (!m) throw new HttpError(404, "not found");
  const t = await requireToken(m.token_id);
  if (!ADMINS.has(account) && account !== t.creator && account !== m.account) throw new HttpError(403, "not allowed");
  store.hideMessage(m.id);
  publish(`token:${m.token_id}`, "hide", { id: m.id });
  return { ok: true };
});

route("GET", "/tokens/:id/calls", async (_req, _res, p) => {
  if (!isValidNearAccount(p.id)) throw new HttpError(400, "invalid token id");
  return store.callsForToken(p.id, 50).map(decorate);
});

route("POST", "/tokens/:id/calls", async (req, _res, p) => {
  checkRate(req, "write", 40);
  const account = auth(req);
  const t = await requireToken(p.id);
  const b = await body<{ thesis: string }>(req);
  const thesis = clean(b.thesis, 280);
  if (thesis.length < 4) throw new HttpError(400, "add a short thesis");
  if (now() - store.lastCallTs(p.id, account) < CALL_COOLDOWN) throw new HttpError(429, "one callout per token per day");
  const mc = await marketCap(p.id);
  if (!mc || mc.usd <= 0) throw new HttpError(503, "market cap unavailable");
  const call = store.addCall({
    token_id: p.id,
    account,
    thesis,
    ts: now(),
    mcap_usd: mc.usd,
    peak_mcap_usd: mc.usd,
    last_mcap_usd: mc.usd,
    updated: now(),
  });
  const out = { ...decorate(call), symbol: t.meta.symbol, icon: t.meta.icon };
  publish(`token:${p.id}`, "call", out);
  publish("global", "call", out);
  return out;
});

route("GET", "/calls", async (_req, _res, _p, q) => {
  const calls = store.recentCalls(clampInt(q.get("limit"), 1, 100, 50));
  return Promise.all(
    calls.map(async (c) => {
      const t = await getToken(c.token_id).catch(() => null);
      return { ...decorate(c), symbol: t?.meta.symbol ?? "?", icon: t?.meta.icon ?? null };
    }),
  );
});

route("GET", "/callers/leaderboard", async (_req, _res, _p, q) => {
  const days = clampInt(q.get("days"), 1, 90, 30);
  return store.leaderboard(now() - days * 86400, 50);
});

route("GET", "/trending/chat", async () => store.messageCounts(now() - 3600));

// ---- trades & candles ----
const TF_MAP: Record<string, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
};

route("GET", "/trades", async (_req, _res, _p, q) => {
  const limit = clampInt(q.get("limit"), 1, 50, 20);
  const rawTrades = store.recentGlobalTrades(limit);
  return Promise.all(
    rawTrades.map(async (tr) => {
      const tok = await getToken(tr.token_id).catch(() => null);
      return {
        ...tr,
        symbol: tok?.meta.symbol ?? tr.token_id.split(".")[0].toUpperCase(),
        icon: tok?.meta.icon ?? null,
      };
    }),
  );
});

route("GET", "/tokens/:id/trades", async (_req, _res, p, q) => {
  if (!isValidNearAccount(p.id)) throw new HttpError(400, "invalid token id");
  const limit = clampInt(q.get("limit"), 1, 100, 50);
  return store.trades(p.id, limit);
});

const lastNudgeByToken = new Map<string, number>();

// Nudge the on-chain indexer immediately after a browser swap; never trust client-supplied trade values.
route("POST", "/tokens/:id/trades", async (req, _res, p) => {
  checkRate(req, "nudge", 30);
  const tok = await requireToken(p.id);
  const last = lastNudgeByToken.get(p.id) ?? 0;
  if (Date.now() - last >= 1500) {
    lastNudgeByToken.set(p.id, Date.now());
    await indexTokenTrades(tok, true).catch(() => {});
  }
  return { ok: true };
});

route("GET", "/tokens/:id/candles", async (_req, _res, p, q) => {
  if (!isValidNearAccount(p.id)) throw new HttpError(400, "invalid token id");
  const tfParam = q.get("tf") ?? "5m";
  const tfSecs = TF_MAP[tfParam] ?? 300;
  const limit = clampInt(q.get("limit"), 1, 200, 100);
  return store.candles(p.id, tfSecs, limit);
});

// ---------------- server ----------------
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin ?? "";
  const allow = ORIGINS.includes("*") ? "*" : ORIGINS.includes(origin) ? origin : "";
  if (allow) res.setHeader("access-control-allow-origin", allow);
  res.setHeader("access-control-allow-headers", "authorization, content-type");
  res.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("x-content-type-options", "nosniff");
  if (req.method === "OPTIONS") return res.writeHead(204).end();

  const url = new URL(req.url ?? "/", "http://x");

  // SSE: /stream?topic=global | token:<id>
  if (req.method === "GET" && url.pathname === "/stream") {
    const topic = url.searchParams.get("topic") ?? "global";
    if (!isValidTopic(topic)) {
      return res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "invalid topic" }));
    }
    if (clients.size >= MAX_SSE_CLIENTS) {
      return res.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ error: "stream busy" }));
    }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.write("retry: 3000\n\n");
    const c = { res, topic };
    clients.add(c);
    req.on("close", () => clients.delete(c));
    return;
  }

  for (const [method, re, h] of routes) {
    const m = req.method === method ? re.exec(url.pathname) : null;
    if (!m) continue;
    try {
      const out = await h(req, res, (m.groups ?? {}) as Record<string, string>, url.searchParams);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      const message = e instanceof HttpError ? e.message : "internal error";
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify({ error: message }));
    }
    return;
  }
  res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "not found" }));
});

// ---------------- on-chain trade indexer ----------------
let indexingBusy = false;
const YOCTO = 10n ** 24n;

async function indexTokenTrades(tok: Awaited<ReturnType<typeof getTokens>>[number], force = false) {
  // Always catch up any unindexed on-curve trades (including pre-graduation history on fresh DBs)
  const lastCurve = store.lastCurveTradeIndex(tok.token_id);
  const tradeCount = (tok as unknown as { trade_count?: number }).trade_count;
  if (tradeCount === undefined || lastCurve + 1 < tradeCount) {
    const fromIdx = Math.max(0, lastCurve + 1);
    const trades = await getTradesFrom(tok.token_id, fromIdx, 50, tradeCount).catch(() => []);
    for (const [idx, tr] of trades) {
      const duplicate = store.hasRecentSimilarTrade(tok.token_id, tr.is_buy ? 1 : 0, tr.tokens, 25);
      const stored: StoredTrade = {
        token_id: tok.token_id,
        id: idx,
        ts: tr.ts,
        account: tr.account,
        is_buy: tr.is_buy ? 1 : 0,
        near: tr.near,
        tokens: tr.tokens,
        price: calcPrice(tr.v_near, tr.v_tokens),
        v_near: tr.v_near,
        v_tokens: tr.v_tokens,
      };
      store.addTrade(stored);
      if (!duplicate) {
        const payload = {
          ...stored,
          symbol: tok.meta.symbol,
          icon: tok.meta.icon,
        };
        publish(`token:${tok.token_id}`, "trade", payload);
        publish("global", "trade", payload);
      }
    }
  }
  if (tok.grad_stage === "Graduated" && tok.pool_id !== null) {
    await indexRefSwaps(tok, force).catch((e) => console.warn("ref swaps:", (e as Error).message));
  }
}

/**
 * Post-graduation trades read from the chain (ref-swaps.ts): each swap on the token's locked
 * Ref pool with its real trader, amounts and block time. The cursor is stored, so restarts
 * resume and the first run backfills the pool's whole history.
 */
const lastRefScan = new Map<string, number>();
const refBusy = new Set<string>();
async function indexRefSwaps(tok: Awaited<ReturnType<typeof getTokens>>[number], force: boolean) {
  if (tok.pool_id === null || refBusy.has(tok.token_id)) return;
  if (!force && Date.now() - (lastRefScan.get(tok.token_id) ?? 0) < 12_000) return;
  refBusy.add(tok.token_id);
  lastRefScan.set(tok.token_id, Date.now());
  try {
    const since = store.refCursor(tok.token_id);
    const { swaps, cursor } = await fetchRefSwaps({
      txApi: defaultTxApi(env("NEAR_NETWORK", "testnet")),
      tokenId: tok.token_id,
      poolId: tok.pool_id,
      ref: REF,
      linear: LINEAR,
      sinceHeight: since,
    });
    if (swaps.length) {
      const linPrice = BigInt(await cached("linear-price", 60_000, () => view<string>(LINEAR, "ft_price").catch(() => YOCTO.toString())));
      for (const sw of swaps) {
        if (!store.claimSwapKey(sw.key)) continue;
        const { nearYocto, price } = swapValue(sw, linPrice, YOCTO);
        const stored: StoredTrade = {
          token_id: tok.token_id,
          id: Math.max(1_000_000_000, store.lastTradeIndex(tok.token_id) + 1),
          ts: sw.ts,
          account: sw.account,
          is_buy: sw.isBuy ? 1 : 0,
          near: nearYocto.toString(),
          tokens: sw.memeAmount.toString(),
          price,
          v_near: "0",
          v_tokens: "0",
        };
        store.addTrade(stored);
        const payload = { ...stored, symbol: tok.meta.symbol, icon: tok.meta.icon };
        publish(`token:${tok.token_id}`, "trade", payload);
        publish("global", "trade", payload);
      }
    }
    if (cursor > since) store.setRefCursor(tok.token_id, cursor);
  } finally {
    refBusy.delete(tok.token_id);
  }
}

async function indexTrades() {
  if (indexingBusy) return;
  indexingBusy = true;
  try {
    const tokens = await getTokens(50).catch(() => []);
    for (const tok of tokens) {
      await indexTokenTrades(tok);
    }
  } finally {
    indexingBusy = false;
  }
}
setInterval(() => indexTrades().catch((e) => console.warn("indexer:", e.message)), 4_000).unref();

// ---------------- callout performance tracker ----------------
async function trackCalls() {
  const since = now() - CALL_WINDOW;
  for (const tokenId of store.trackedTokens(since)) {
    const mc = await marketCap(tokenId).catch(() => null);
    if (mc && mc.usd > 0) store.updateCallMcaps(tokenId, mc.usd, since);
  }
}
setInterval(() => trackCalls().catch((e) => console.warn("tracker:", e.message)), 60_000).unref();

server.listen(PORT, () => console.log(`floorpad social API on :${PORT} (launchpad ${LAUNCHPAD})`));
