/**
 * Floorpad social API: per-token live chat + callouts with tracked performance.
 *
 * Auth: the wallet signs a NEP-413 message once (no transaction, no gas); the
 * server checks it is a full-access key of the account and issues a session.
 * Live updates use Server-Sent Events. Storage is node:sqlite. No runtime deps.
 */
import http from "node:http";
import { randomBytes } from "node:crypto";
import { env, getToken, holderShare, isFullAccessKey, LAUNCHPAD, marketCap } from "./chain.ts";
import { verifySignedMessage } from "./nep413.ts";
import { openStore, type Call, type Message } from "./store.ts";

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
