/**
 * Floorpad social API: per-token live chat + callouts with tracked performance.
 *
 * Auth: the wallet signs a NEP-413 message once (no transaction, no gas); the
 * server checks it is a full-access key of the account and issues a session.
 * Live updates use Server-Sent Events. Storage is node:sqlite. No runtime deps.
 */
import http from "node:http";
import { randomBytes } from "node:crypto";
import {
  calcPrice,
  cached,
  env,
  getToken,
  getTokens,
  getTradesFrom,
  holderShare,
  isFullAccessKey,
  LAUNCHPAD,
  LINEAR,
  marketCap,
  REF,
  view,
} from "./chain.ts";
import { verifySignedMessage } from "./nep413.ts";
import { openStore, type Call, type Message, type StoredTrade } from "./store.ts";

try {
  process.loadEnvFile?.(".env");
} catch {
  /* optional */
}

const PORT = Number(env("PORT", "8787"));
const ORIGINS = env("CORS_ORIGINS", "*").split(",").map((s) => s.trim());
const ADMINS = new Set(env("ADMINS", "").split(",").map((s) => s.trim()).filter(Boolean));
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

async function requireToken(tokenId: string) {
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

route("POST", "/auth/challenge", async () => {
  const nonce = randomBytes(32).toString("base64");
  store.addChallenge(nonce);
  return { nonce, message: SIGN_MESSAGE, recipient: RECIPIENT };
});

route("POST", "/auth/verify", async (req) => {
  const b = await body<{ accountId: string; publicKey: string; signature: string; nonce: string; callbackUrl?: string }>(req);
  if (!b.accountId || !b.publicKey || !b.signature || !b.nonce) throw new HttpError(400, "missing fields");
  if (!store.takeChallenge(b.nonce)) throw new HttpError(400, "unknown or expired challenge");
  const ok = verifySignedMessage({
    publicKey: b.publicKey,
    signature: b.signature,
    message: SIGN_MESSAGE,
    nonce: Buffer.from(b.nonce, "base64"),
    recipient: RECIPIENT,
    callbackUrl: b.callbackUrl ?? null,
  });
  if (!ok) throw new HttpError(401, "bad signature");
  if (!(await isFullAccessKey(b.accountId, b.publicKey))) throw new HttpError(401, "key is not a full-access key of this account");
  const token = randomBytes(32).toString("base64url");
  store.addSession(token, b.accountId);
  return { token, accountId: b.accountId };
});

route("GET", "/me", async (req) => ({ accountId: auth(req) }));

route("GET", "/tokens/:id/messages", async (_req, _res, p, q) => {
  const before = q.get("before") ? Number(q.get("before")) : null;
  return store.messages(p.id, before, Math.min(100, Number(q.get("limit") ?? 50)));
});

route("POST", "/tokens/:id/messages", async (req, _res, p) => {
  const account = auth(req);
  const t = await requireToken(p.id);
  const b = await body<{ text: string; replyTo?: number }>(req);
  const text = clean(b.text, MAX_TEXT);
  if (!text) throw new HttpError(400, "empty message");
  if (now() - store.lastMessageTs(p.id, account) < MSG_COOLDOWN) throw new HttpError(429, "slow down");
  const m: Omit<Message, "id"> = {
    token_id: p.id,
    account,
    text,
    reply_to: b.replyTo ?? null,
    ts: now(),
    is_dev: account === t.creator ? 1 : 0,
    holder_pct: await holderShare(p.id, account).catch(() => 0),
  };
  const saved = store.addMessage(m);
  publish(`token:${p.id}`, "message", saved);
  return saved;
});

route("DELETE", "/messages/:id", async (req, _res, p) => {
  const account = auth(req);
  const m = store.message(Number(p.id));
  if (!m) throw new HttpError(404, "not found");
  const t = await requireToken(m.token_id);
  if (!ADMINS.has(account) && account !== t.creator && account !== m.account) throw new HttpError(403, "not allowed");
  store.hideMessage(m.id);
  publish(`token:${m.token_id}`, "hide", { id: m.id });
  return { ok: true };
});

route("GET", "/tokens/:id/calls", async (_req, _res, p) => store.callsForToken(p.id, 50).map(decorate));

route("POST", "/tokens/:id/calls", async (req, _res, p) => {
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
  const calls = store.recentCalls(Math.min(100, Number(q.get("limit") ?? 50)));
  return Promise.all(
    calls.map(async (c) => {
      const t = await getToken(c.token_id).catch(() => null);
      return { ...decorate(c), symbol: t?.meta.symbol ?? "?", icon: t?.meta.icon ?? null };
    }),
  );
});

route("GET", "/callers/leaderboard", async (_req, _res, _p, q) => {
  const days = Math.min(90, Number(q.get("days") ?? 30));
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
  const limit = Math.min(50, Number(q.get("limit") ?? 20));
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
  const limit = Math.min(100, Number(q.get("limit") ?? 50));
  return store.trades(p.id, limit);
});

route("POST", "/tokens/:id/trades", async (req, _res, p) => {
  const b = await body<{
    account: string;
    is_buy: boolean;
    near: string;
    tokens: string;
    price: number;
    v_near?: string;
    v_tokens?: string;
  }>(req);
  if (!b.account || !b.near || !b.tokens) throw new HttpError(400, "invalid trade body");

  const tok = await getToken(p.id).catch(() => null);
  const ts = now();
  const nextId = Math.max(1_000_000_000, (store.lastTradeIndex(p.id) || 0) + 1);
  const stored: StoredTrade = {
    token_id: p.id,
    id: nextId,
    ts,
    account: clean(b.account, 64),
    is_buy: b.is_buy ? 1 : 0,
    near: b.near,
    tokens: b.tokens,
    price: b.price || calcPrice(b.v_near || b.near, b.v_tokens || b.tokens),
    v_near: b.v_near || b.near,
    v_tokens: b.v_tokens || b.tokens,
  };
  store.addTrade(stored);
  const payload = {
    ...stored,
    symbol: tok?.meta.symbol ?? p.id.split(".")[0].toUpperCase(),
    icon: tok?.meta.icon ?? null,
  };
  publish(`token:${p.id}`, "trade", payload);
  publish("global", "trade", payload);
  return stored;
});

route("GET", "/tokens/:id/candles", async (_req, _res, p, q) => {
  const tfParam = q.get("tf") ?? "5m";
  const tfSecs = TF_MAP[tfParam] ?? 300;
  const limit = Math.min(200, Number(q.get("limit") ?? 100));
  return store.candles(p.id, tfSecs, limit);
});

// ---------------- server ----------------
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin ?? "";
  const allow = ORIGINS.includes("*") ? "*" : ORIGINS.includes(origin) ? origin : "";
  if (allow) res.setHeader("access-control-allow-origin", allow);
  res.setHeader("access-control-allow-headers", "authorization, content-type");
  res.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.writeHead(204).end();

  const url = new URL(req.url ?? "/", "http://x");

  // SSE: /stream?topic=global | token:<id>
  if (req.method === "GET" && url.pathname === "/stream") {
    const topic = url.searchParams.get("topic") ?? "global";
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
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify({ error: (e as Error).message }));
    }
    return;
  }
  res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "not found" }));
});

// ---------------- on-chain trade indexer ----------------
let indexingBusy = false;
const prevPoolReserves = new Map<number, { rMeme: bigint; rLin: bigint }>();
const YOCTO = 10n ** 24n;

async function indexTrades() {
  if (indexingBusy) return;
  indexingBusy = true;
  try {
    const tokens = await getTokens(50).catch(() => []);
    for (const tok of tokens) {
      // Always catch up any unindexed on-curve trades (including pre-graduation history on fresh DBs)
      const lastCurve = store.lastCurveTradeIndex(tok.token_id);
      if ((tok as unknown as { trade_count?: number }).trade_count === undefined || lastCurve + 1 < ((tok as unknown as { trade_count?: number }).trade_count ?? Number.MAX_SAFE_INTEGER)) {
        const fromIdx = Math.max(0, lastCurve + 1);
        const trades = await getTradesFrom(tok.token_id, fromIdx, 50, (tok as unknown as { trade_count?: number }).trade_count).catch(() => []);
        for (const [idx, tr] of trades) {
          if (store.hasRecentSimilarTrade(tok.token_id, tr.is_buy ? 1 : 0, tr.tokens, 25)) {
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
            continue;
          }
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
          const payload = {
            ...stored,
            symbol: tok.meta.symbol,
            icon: tok.meta.icon,
          };
          store.addTrade(stored);
          publish(`token:${tok.token_id}`, "trade", payload);
          publish("global", "trade", payload);
        }
      }
      if (tok.grad_stage === "Graduated" && tok.pool_id !== null) {
        // Ref Finance pool indexing for graduated tokens
        try {
          const pool = await view<{ token_account_ids: string[]; amounts: string[] }>(REF, "get_pool", {
            pool_id: tok.pool_id,
          });
          if (pool && pool.amounts && pool.amounts.length >= 2) {
            const iMeme = Math.max(0, pool.token_account_ids.indexOf(tok.token_id));
            const currMeme = BigInt(pool.amounts[iMeme]);
            const currLin = BigInt(pool.amounts[1 - iMeme]);
            const prev = prevPoolReserves.get(tok.pool_id);

            if (prev) {
              const deltaMeme = currMeme - prev.rMeme;
              const deltaLin = currLin - prev.rLin;

              // If pool reserves shifted, a swap occurred
              if (deltaMeme !== 0n) {
                const isBuy = deltaMeme < 0n; // tokens left pool to buyer
                const absMeme = deltaMeme < 0n ? -deltaMeme : deltaMeme;
                const absLin = deltaLin < 0n ? -deltaLin : deltaLin;
                const isBuyInt = isBuy ? 1 : 0;
                if (!store.hasRecentSimilarTrade(tok.token_id, isBuyInt, absMeme.toString(), 25)) {
                  const linPrice = BigInt(
                    await cached("linear-price", 60_000, () => view<string>(LINEAR, "ft_price").catch(() => YOCTO.toString())),
                  );
                  const nearYocto = (absLin * linPrice) / YOCTO;
                  const price =
                    absMeme > 0n
                      ? Number((nearYocto * 10n ** 18n) / absMeme) / 1e18 / 1e6
                      : 0;

                  const nextId = Math.max(1_000_000_000, (store.lastTradeIndex(tok.token_id) || 0) + 1);
                  const stored: StoredTrade = {
                    token_id: tok.token_id,
                    id: nextId,
                    ts: now(),
                    account: "ref-finance.near",
                    is_buy: isBuyInt,
                    near: nearYocto.toString(),
                    tokens: absMeme.toString(),
                    price,
                    v_near: currLin.toString(),
                    v_tokens: currMeme.toString(),
                  };
                  const payload = {
                    ...stored,
                    symbol: tok.meta.symbol,
                    icon: tok.meta.icon,
                  };
                  store.addTrade(stored);
                  publish(`token:${tok.token_id}`, "trade", payload);
                  publish("global", "trade", payload);
                }
              }
            }
            prevPoolReserves.set(tok.pool_id, { rMeme: currMeme, rLin: currLin });
          }
        } catch {
          // ignore transient rpc errors
        }
      }
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
