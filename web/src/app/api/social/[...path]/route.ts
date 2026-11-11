import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  getSocialBackend,
  getToken,
  holderShare,
  isFullAccessKey,
  isValidNearAccount,
  marketCap,
  RECIPIENT,
  SIGN_MESSAGE,
  verifySignedMessage,
} from "@/lib/social-backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16_384;
const MAX_SSE_CLIENTS = 500;
const RATE_MAX_KEYS = 10_000;
const MAX_TEXT = 500;
const MSG_COOLDOWN = 2;
const CALL_COOLDOWN = 24 * 3600;
const TF_MAP: Record<string, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400 };
const now = () => Math.floor(Date.now() / 1000);
const clean = (s: unknown, max: number) =>
  String(s ?? "")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);

const gRate = globalThis as unknown as {
  __floorpadRate?: Map<string, { resetAt: number; count: number }>;
  __floorpadSseCount?: number;
};
const rateBuckets = (gRate.__floorpadRate ??= new Map());

function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  return (xff?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown").slice(0, 64);
}

function isRateLimited(req: NextRequest, bucket: string, maxPerMin: number): boolean {
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
    return false;
  }
  entry.count += 1;
  return entry.count > maxPerMin;
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

class BodyTooLargeError extends Error {}

async function readLimitedText(req: NextRequest): Promise<string> {
  const cl = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(cl) && cl > MAX_BODY_BYTES) throw new BodyTooLargeError("body too large");
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) throw new BodyTooLargeError("body too large");
  return raw;
}

function decorateCall(c: {
  id: number;
  token_id: string;
  account: string;
  thesis: string;
  ts: number;
  mcap_usd: number;
  peak_mcap_usd: number;
  last_mcap_usd: number;
  updated: number;
}) {
  return {
    ...c,
    x_now: c.mcap_usd > 0 ? c.last_mcap_usd / c.mcap_usd : 0,
    x_peak: c.mcap_usd > 0 ? c.peak_mcap_usd / c.mcap_usd : 0,
  };
}

async function proxyUpstream(req: NextRequest, segments: string[], rawBody?: string) {
  const upstream = process.env.SOCIAL_API_URL?.replace(/\/$/, "");
  if (!upstream) return null;

  const url = new URL(req.url);
  const encodedPath = segments.map((s) => encodeURIComponent(s)).join("/");
  const target = `${upstream}/${encodedPath}${url.search}`;
  const headers: Record<string, string> = {};
  const auth = req.headers.get("authorization");
  if (auth) headers.authorization = auth;
  const ct = req.headers.get("content-type");
  if (ct) headers["content-type"] = ct;

  const init: RequestInit = { method: req.method, headers, signal: AbortSignal.timeout(10_000) };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = rawBody ?? (await readLimitedText(req));
  }
  const r = await fetch(target, init);
  if (segments[0] === "stream" && r.body) {
    return new Response(r.body, {
      status: r.status,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  }
  const text = await r.text();
  return new NextResponse(text, {
    status: r.status,
    headers: { "content-type": r.headers.get("content-type") || "application/json" },
  });
}

function authAccount(req: NextRequest): string | null {
  const h = req.headers.get("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  return token ? getSocialBackend().sessionAccount(token) : null;
}

async function handle(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (!Array.isArray(path) || path.some((s) => !s || s === "." || s === ".." || /[/\\\u0000-\u001F]/.test(s))) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }

  let preReadBody: string | undefined;
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      preReadBody = await readLimitedText(req);
    }
  } catch (e) {
    if (e instanceof BodyTooLargeError) {
      return NextResponse.json({ error: "body too large" }, { status: 413 });
    }
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const upstreamResp = await proxyUpstream(req, path, preReadBody).catch(() => null);
  if (upstreamResp) return upstreamResp;

  const backend = getSocialBackend();
  const q = new URL(req.url).searchParams;
  const method = req.method;
  const p = "/" + path.join("/");

  // SSE stream: GET /api/social/stream?topic=...
  if (method === "GET" && p === "/stream") {
    const topic = q.get("topic") ?? "global";
    if (!isValidTopic(topic)) {
      return NextResponse.json({ error: "invalid topic" }, { status: 400 });
    }
    if ((gRate.__floorpadSseCount ?? 0) >= MAX_SSE_CLIENTS) {
      return NextResponse.json({ error: "stream busy" }, { status: 503 });
    }
    const encoder = new TextEncoder();
    let cleanup: (() => void) | null = null;
    const stream = new ReadableStream({
      start(controller) {
        gRate.__floorpadSseCount = (gRate.__floorpadSseCount ?? 0) + 1;
        controller.enqueue(encoder.encode("retry: 3000\n\n"));
        const unsub = backend.subscribe(topic, (event, data) => {
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch {
            // closed
          }
        });
        const ping = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch {
            // closed
          }
        }, 25_000);
        cleanup = () => {
          clearInterval(ping);
          unsub();
          gRate.__floorpadSseCount = Math.max(0, (gRate.__floorpadSseCount ?? 1) - 1);
          cleanup = null;
        };
      },
      cancel() {
        cleanup?.();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  }

  try {
    if (method === "GET" && p === "/health") {
      return NextResponse.json({ ok: true });
    }

    if (method === "POST" && p === "/auth/challenge") {
      if (isRateLimited(req, "auth", 20)) return NextResponse.json({ error: "too many requests" }, { status: 429 });
      return NextResponse.json(backend.addChallengeAndIssue());
    }

    if (method === "POST" && p === "/auth/verify") {
      if (isRateLimited(req, "auth", 20)) return NextResponse.json({ error: "too many requests" }, { status: 429 });
      let b: { accountId?: string; publicKey?: string; signature?: string; nonce?: string; callbackUrl?: string };
      try {
        b = (preReadBody ? JSON.parse(preReadBody) : {}) as typeof b;
      } catch {
        return NextResponse.json({ error: "invalid json" }, { status: 400 });
      }
      if (!b.accountId || !b.publicKey || !b.signature || !b.nonce) {
        return NextResponse.json({ error: "missing fields" }, { status: 400 });
      }
      if (!isValidNearAccount(b.accountId)) {
        return NextResponse.json({ error: "invalid account id" }, { status: 400 });
      }
      if (typeof b.publicKey !== "string" || typeof b.signature !== "string" || typeof b.nonce !== "string") {
        return NextResponse.json({ error: "invalid fields" }, { status: 400 });
      }
      if (!backend.takeChallenge(b.nonce)) {
        return NextResponse.json({ error: "unknown or expired challenge" }, { status: 400 });
      }
      const ok = verifySignedMessage({
        publicKey: b.publicKey,
        signature: b.signature,
        message: SIGN_MESSAGE,
        nonce: Buffer.from(b.nonce, "base64"),
        recipient: RECIPIENT,
        callbackUrl: typeof b.callbackUrl === "string" && b.callbackUrl.length <= 512 ? b.callbackUrl : null,
      });
      if (!ok) return NextResponse.json({ error: "bad signature" }, { status: 401 });
      if (!(await isFullAccessKey(b.accountId, b.publicKey))) {
        return NextResponse.json({ error: "key is not a full-access key of this account" }, { status: 401 });
      }
      const token = randomBytes(32).toString("base64url");
      backend.addSession(token, b.accountId);
      return NextResponse.json({ token, accountId: b.accountId });
    }

    if (method === "GET" && p === "/me") {
      const account = authAccount(req);
      if (!account) return NextResponse.json({ error: "sign in required" }, { status: 401 });
      return NextResponse.json({ accountId: account });
    }

    if (method === "GET" && p === "/trending/chat") {
      return NextResponse.json(backend.messageCounts(now() - 3600));
    }

    if (method === "GET" && p === "/callers/leaderboard") {
      const days = clampInt(q.get("days"), 1, 90, 30);
      return NextResponse.json(backend.leaderboard(now() - days * 86400, 50));
    }

    if (method === "GET" && p === "/calls") {
      const calls = backend.recentCalls(clampInt(q.get("limit"), 1, 100, 50));
      const out = await Promise.all(
        calls.map(async (c) => {
          const t = await getToken(c.token_id).catch(() => null);
          return { ...decorateCall(c), symbol: t?.meta.symbol ?? "?", icon: t?.meta.icon ?? null };
        }),
      );
      return NextResponse.json(out);
    }

    if (method === "GET" && p === "/trades") {
      await backend.ensureIndexedRecent();
      const limit = clampInt(q.get("limit"), 1, 50, 20);
      const rows = backend.recentGlobalTrades(limit);
      const out = await Promise.all(
        rows.map(async (tr) => {
          const tok = await getToken(tr.token_id).catch(() => null);
          return {
            ...tr,
            symbol: tok?.meta.symbol ?? tr.token_id.split(".")[0].toUpperCase(),
            icon: tok?.meta.icon ?? null,
          };
        }),
      );
      return NextResponse.json(out);
    }

    // Token-scoped routes
    let m: RegExpExecArray | null;

    if ((m = /^\/tokens\/([^/]+)\/messages$/.exec(p))) {
      const tokenId = decodeURIComponent(m[1]);
      if (!isValidNearAccount(tokenId)) {
        return NextResponse.json({ error: "invalid token id" }, { status: 400 });
      }
      if (method === "GET") {
        const before = q.get("before") ? clampInt(q.get("before"), 1, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER) : null;
        return NextResponse.json(backend.messages(tokenId, before, clampInt(q.get("limit"), 1, 100, 50)));
      }
      if (method === "POST") {
        if (isRateLimited(req, "write", 40)) return NextResponse.json({ error: "too many requests" }, { status: 429 });
        const account = authAccount(req);
        if (!account) return NextResponse.json({ error: "sign in required" }, { status: 401 });
        const tok = await getToken(tokenId).catch(() => null);
        if (!tok) return NextResponse.json({ error: "unknown token" }, { status: 404 });
        let b: { text?: string; replyTo?: number };
        try {
          b = (preReadBody ? JSON.parse(preReadBody) : {}) as typeof b;
        } catch {
          return NextResponse.json({ error: "invalid json" }, { status: 400 });
        }
        const text = clean(b.text, MAX_TEXT);
        if (!text) return NextResponse.json({ error: "empty message" }, { status: 400 });
        if (now() - backend.lastMessageTs(tokenId, account) < MSG_COOLDOWN) {
          return NextResponse.json({ error: "slow down" }, { status: 429 });
        }
        let replyTo: number | null = null;
        if (b.replyTo !== undefined && b.replyTo !== null) {
          const rid = Number(b.replyTo);
          if (!Number.isSafeInteger(rid) || rid <= 0) {
            return NextResponse.json({ error: "invalid reply target" }, { status: 400 });
          }
          const target = backend.state.messages.find((x) => x.id === rid && !x.hidden && x.token_id === tokenId);
          if (!target) return NextResponse.json({ error: "invalid reply target" }, { status: 400 });
          replyTo = rid;
        }
        const saved = backend.addMessage({
          token_id: tokenId,
          account,
          text,
          reply_to: replyTo,
          ts: now(),
          is_dev: account === tok.creator ? 1 : 0,
          holder_pct: await holderShare(tokenId, account).catch(() => 0),
        });
        return NextResponse.json(saved);
      }
    }

    if ((m = /^\/messages\/(\d+)$/.exec(p)) && method === "DELETE") {
      if (isRateLimited(req, "write", 40)) return NextResponse.json({ error: "too many requests" }, { status: 429 });
      const account = authAccount(req);
      if (!account) return NextResponse.json({ error: "sign in required" }, { status: 401 });
      const msgId = clampInt(m[1], 1, Number.MAX_SAFE_INTEGER, 0);
      if (!msgId) return NextResponse.json({ error: "invalid message id" }, { status: 400 });
      const msg = backend.state.messages.find((x) => x.id === msgId);
      if (!msg) return NextResponse.json({ error: "not found" }, { status: 404 });
      const tok = await getToken(msg.token_id).catch(() => null);
      if (!tok) return NextResponse.json({ error: "unknown token" }, { status: 404 });
      if (!backend.hideMessage(msgId, account, tok.creator)) {
        return NextResponse.json({ error: "not allowed" }, { status: 403 });
      }
      return NextResponse.json({ ok: true });
    }

    if ((m = /^\/tokens\/([^/]+)\/calls$/.exec(p))) {
      const tokenId = decodeURIComponent(m[1]);
      if (!isValidNearAccount(tokenId)) {
        return NextResponse.json({ error: "invalid token id" }, { status: 400 });
      }
      if (method === "GET") {
        return NextResponse.json(backend.callsForToken(tokenId, 50).map(decorateCall));
      }
      if (method === "POST") {
        if (isRateLimited(req, "write", 40)) return NextResponse.json({ error: "too many requests" }, { status: 429 });
        const account = authAccount(req);
        if (!account) return NextResponse.json({ error: "sign in required" }, { status: 401 });
        const tok = await getToken(tokenId).catch(() => null);
        if (!tok) return NextResponse.json({ error: "unknown token" }, { status: 404 });
        let b: { thesis?: string };
        try {
          b = (preReadBody ? JSON.parse(preReadBody) : {}) as typeof b;
        } catch {
          return NextResponse.json({ error: "invalid json" }, { status: 400 });
        }
        const thesis = clean(b.thesis, 280);
        if (thesis.length < 4) return NextResponse.json({ error: "add a short thesis" }, { status: 400 });
        if (now() - backend.lastCallTs(tokenId, account) < CALL_COOLDOWN) {
          return NextResponse.json({ error: "one callout per token per day" }, { status: 429 });
        }
        const mc = await marketCap(tokenId);
        if (!mc || mc.usd <= 0) return NextResponse.json({ error: "market cap unavailable" }, { status: 503 });
        const call = backend.addCall({
          token_id: tokenId,
          account,
          thesis,
          ts: now(),
          mcap_usd: mc.usd,
          peak_mcap_usd: mc.usd,
          last_mcap_usd: mc.usd,
          updated: now(),
        });
        const out = { ...decorateCall(call), symbol: tok.meta.symbol, icon: tok.meta.icon };
        backend.publish(`token:${tokenId}`, "call", out);
        backend.publish("global", "call", out);
        return NextResponse.json(out);
      }
    }

    if ((m = /^\/tokens\/([^/]+)\/trades$/.exec(p))) {
      const tokenId = decodeURIComponent(m[1]);
      if (!isValidNearAccount(tokenId)) {
        return NextResponse.json({ error: "invalid token id" }, { status: 400 });
      }
      if (method === "GET") {
        await backend.ensureIndexedRecent();
        const limit = clampInt(q.get("limit"), 1, 100, 50);
        return NextResponse.json(backend.tradesForToken(tokenId, limit));
      }
      if (method === "POST") {
        // Trigger authoritative on-chain indexing instead of trusting client-supplied trade amounts/prices.
        if (isRateLimited(req, "nudge", 30)) return NextResponse.json({ error: "too many requests" }, { status: 429 });
        const tok = await getToken(tokenId).catch(() => null);
        if (!tok) return NextResponse.json({ error: "unknown token" }, { status: 404 });
        await backend.indexTokenTrades(tok).catch(() => {});
        return NextResponse.json({ ok: true });
      }
    }

    if ((m = /^\/tokens\/([^/]+)\/candles$/.exec(p)) && method === "GET") {
      const tokenId = decodeURIComponent(m[1]);
      if (!isValidNearAccount(tokenId)) {
        return NextResponse.json({ error: "invalid token id" }, { status: 400 });
      }
      await backend.ensureIndexedRecent();
      const tfParam = q.get("tf") ?? "5m";
      const tfSecs = TF_MAP[tfParam] ?? 300;
      const limit = clampInt(q.get("limit"), 1, 200, 100);
      return NextResponse.json(backend.candles(tokenId, tfSecs, limit));
    }

    return NextResponse.json({ error: "not found" }, { status: 404 });
  } catch (e) {
    console.error("social-api error:", e);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return handle(req, context);
}
export async function POST(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return handle(req, context);
}
export async function DELETE(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return handle(req, context);
}
