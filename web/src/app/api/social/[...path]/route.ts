import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  getSocialBackend,
  getToken,
  holderShare,
  isFullAccessKey,
  marketCap,
  RECIPIENT,
  SIGN_MESSAGE,
  verifySignedMessage,
} from "@/lib/social-backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

async function proxyUpstream(req: NextRequest, segments: string[]) {
  const upstream = process.env.SOCIAL_API_URL?.replace(/\/$/, "");
  if (!upstream) return null;

  const url = new URL(req.url);
  const target = `${upstream}/${segments.join("/")}${url.search}`;
  const headers: Record<string, string> = {};
  const auth = req.headers.get("authorization");
  if (auth) headers.authorization = auth;
  const ct = req.headers.get("content-type");
  if (ct) headers["content-type"] = ct;

  const init: RequestInit = { method: req.method, headers };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.text();
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
  const upstreamResp = await proxyUpstream(req, path).catch(() => null);
  if (upstreamResp) return upstreamResp;

  const backend = getSocialBackend();
  const q = new URL(req.url).searchParams;
  const method = req.method;
  const p = "/" + path.join("/");

  // SSE stream: GET /api/social/stream?topic=...
  if (method === "GET" && p === "/stream") {
    const topic = q.get("topic") ?? "global";
    const encoder = new TextEncoder();
    let cleanup: (() => void) | null = null;
    const stream = new ReadableStream({
      start(controller) {
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
      return NextResponse.json(backend.addChallengeAndIssue());
    }

    if (method === "POST" && p === "/auth/verify") {
      const b = (await req.json().catch(() => ({}))) as {
        accountId?: string;
        publicKey?: string;
        signature?: string;
        nonce?: string;
        callbackUrl?: string;
      };
      if (!b.accountId || !b.publicKey || !b.signature || !b.nonce) {
        return NextResponse.json({ error: "missing fields" }, { status: 400 });
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
        callbackUrl: b.callbackUrl ?? null,
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
      const days = Math.min(90, Number(q.get("days") ?? 30));
      return NextResponse.json(backend.leaderboard(now() - days * 86400, 50));
    }

    if (method === "GET" && p === "/calls") {
      const calls = backend.recentCalls(Math.min(100, Number(q.get("limit") ?? 50)));
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
      const limit = Math.min(50, Number(q.get("limit") ?? 20));
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
      if (method === "GET") {
        const before = q.get("before") ? Number(q.get("before")) : null;
        return NextResponse.json(backend.messages(tokenId, before, Math.min(100, Number(q.get("limit") ?? 50))));
      }
      if (method === "POST") {
        const account = authAccount(req);
        if (!account) return NextResponse.json({ error: "sign in required" }, { status: 401 });
        const tok = await getToken(tokenId).catch(() => null);
        if (!tok) return NextResponse.json({ error: "unknown token" }, { status: 404 });
        const b = (await req.json().catch(() => ({}))) as { text?: string; replyTo?: number };
        const text = clean(b.text, MAX_TEXT);
        if (!text) return NextResponse.json({ error: "empty message" }, { status: 400 });
        if (now() - backend.lastMessageTs(tokenId, account) < MSG_COOLDOWN) {
          return NextResponse.json({ error: "slow down" }, { status: 429 });
        }
        const saved = backend.addMessage({
          token_id: tokenId,
          account,
          text,
          reply_to: b.replyTo ?? null,
          ts: now(),
          is_dev: account === tok.creator ? 1 : 0,
          holder_pct: await holderShare(tokenId, account).catch(() => 0),
        });
        return NextResponse.json(saved);
      }
    }

    if ((m = /^\/messages\/(\d+)$/.exec(p)) && method === "DELETE") {
      const account = authAccount(req);
      if (!account) return NextResponse.json({ error: "sign in required" }, { status: 401 });
      const msgId = Number(m[1]);
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
      if (method === "GET") {
        return NextResponse.json(backend.callsForToken(tokenId, 50).map(decorateCall));
      }
      if (method === "POST") {
        const account = authAccount(req);
        if (!account) return NextResponse.json({ error: "sign in required" }, { status: 401 });
        const tok = await getToken(tokenId).catch(() => null);
        if (!tok) return NextResponse.json({ error: "unknown token" }, { status: 404 });
        const b = (await req.json().catch(() => ({}))) as { thesis?: string };
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
      if (method === "GET") {
        await backend.ensureIndexedRecent();
        const limit = Math.min(100, Number(q.get("limit") ?? 50));
        return NextResponse.json(backend.tradesForToken(tokenId, limit));
      }
      if (method === "POST") {
        const b = (await req.json().catch(() => ({}))) as {
          account?: string;
          is_buy?: boolean;
          near?: string;
          tokens?: string;
          price?: number;
          v_near?: string;
          v_tokens?: string;
        };
        if (!b.account || !b.near || !b.tokens) {
          return NextResponse.json({ error: "invalid trade body" }, { status: 400 });
        }
        const tok = await getToken(tokenId).catch(() => null);
        const ts = now();
        const nextId = Math.max(1_000_000_000, backend.lastTradeIndex(tokenId) + 1);
        const stored = {
          token_id: tokenId,
          id: nextId,
          ts,
          account: clean(b.account, 64),
          is_buy: b.is_buy ? 1 : 0,
          near: b.near,
          tokens: b.tokens,
          price: b.price || 0,
          v_near: b.v_near || b.near,
          v_tokens: b.v_tokens || b.tokens,
        };
        backend.addTrade(stored);
        const payload = {
          ...stored,
          symbol: tok?.meta.symbol ?? tokenId.split(".")[0].toUpperCase(),
          icon: tok?.meta.icon ?? null,
        };
        backend.publish(`token:${tokenId}`, "trade", payload);
        backend.publish("global", "trade", payload);
        return NextResponse.json(stored);
      }
    }

    if ((m = /^\/tokens\/([^/]+)\/candles$/.exec(p)) && method === "GET") {
      await backend.ensureIndexedRecent();
      const tokenId = decodeURIComponent(m[1]);
      const tfParam = q.get("tf") ?? "5m";
      const tfSecs = TF_MAP[tfParam] ?? 300;
      const limit = Math.min(200, Number(q.get("limit") ?? 100));
      return NextResponse.json(backend.candles(tokenId, tfSecs, limit));
    }

    return NextResponse.json({ error: "not found" }, { status: 404 });
  } catch (e) {
    console.error("social-api error:", e);
    return NextResponse.json({ error: (e as Error).message || "internal error" }, { status: 500 });
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

