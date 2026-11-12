/**
 * Social distribution & interactive group replies for Floorpad AI agents:
 *   - Telegram Bot API (channels/groups broadcast + /stats /floor /price & @mention replies)
 *   - X (Twitter) API v2 tweet posting via OAuth 1.0a HMAC-SHA1 (or OAuth 2.0 user bearer)
 * Zero runtime dependencies: uses Node's built-in fetch + node:crypto.
 */
import { createHmac, randomBytes } from "node:crypto";

export interface AgentTokenInfo {
  token_id: string;
  meta: {
    name: string;
    symbol: string;
    description: string;
    twitter?: string | null;
    telegram?: string | null;
  };
  agent_persona: string;
  stats: Record<string, unknown>;
}

const WEB_URL = (process.env.WEB_BASE_URL ?? "https://usefloorpad.fun").replace(/\/+$/, "");

// ---------------- Telegram ----------------
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const TG_DEFAULT_CHAT = process.env.TELEGRAM_DEFAULT_CHAT_ID ?? "";
const TG_CHAT_MAP: Record<string, string> = (() => {
  try {
    return JSON.parse(process.env.TELEGRAM_CHAT_MAP ?? "{}");
  } catch {
    return {};
  }
})();
const TG_POLL = process.env.TELEGRAM_POLL !== "0";

let tgOffset = 0;
let tgBotUsername = "";

async function tgCall<T>(method: string, body: Record<string, unknown>): Promise<T | null> {
  if (!TG_TOKEN) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.warn(`telegram ${method} ${res.status}: ${await res.text()}`);
      return null;
    }
    const json = (await res.json()) as { ok: boolean; result?: T };
    return json.ok ? (json.result ?? null) : null;
  } catch (e) {
    console.warn(`telegram ${method}:`, (e as Error).message);
    return null;
  }
}

function resolveTelegramTargets(t: AgentTokenInfo): string[] {
  const targets = new Set<string>();
  const mapped = TG_CHAT_MAP[t.token_id] ?? TG_CHAT_MAP[t.meta.symbol.toUpperCase()];
  if (mapped) targets.add(mapped);
  if (TG_DEFAULT_CHAT) targets.add(TG_DEFAULT_CHAT);
  // If token metadata links a public t.me/<group> and bot is added as admin, target @<group>
  const tgMeta = t.meta.telegram?.trim();
  if (tgMeta) {
    const handle = tgMeta
      .replace(/^https?:\/\/(t\.me|telegram\.me)\//i, "")
      .replace(/^@/, "")
      .split(/[/?#]/)[0];
    if (/^[a-zA-Z0-9_]{5,32}$/.test(handle) && !mapped) {
      targets.add(`@${handle}`);
    }
  }
  return [...targets];
}

export async function postToTelegram(t: AgentTokenInfo, text: string) {
  if (!TG_TOKEN) return;
  const targets = resolveTelegramTargets(t);
  if (targets.length === 0) return;
  const msg = `$${t.meta.symbol} (${t.meta.name})\n\n${text}\n\n${WEB_URL}/token/${t.token_id}`;
  for (const chat_id of targets) {
    await tgCall("sendMessage", {
      chat_id,
      text: msg.slice(0, 4000),
      disable_web_page_preview: true,
    });
  }
}

interface TgUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string; username?: string };
    text?: string;
    reply_to_message?: { from?: { is_bot?: boolean; username?: string } };
  };
}

export async function pollTelegramCommands(
  tokens: AgentTokenInfo[],
  generateReply: (t: AgentTokenInfo, question: string) => Promise<string>,
) {
  if (!TG_TOKEN || !TG_POLL || tokens.length === 0) return;
  if (!tgBotUsername) {
    const me = await tgCall<{ username?: string }>("getMe", {});
    tgBotUsername = me?.username?.toLowerCase() ?? "";
  }
  const updates = await tgCall<TgUpdate[]>("getUpdates", {
    offset: tgOffset,
    limit: 20,
    timeout: 0,
    allowed_updates: ["message"],
  });
  if (!updates?.length) return;

  for (const u of updates) {
    tgOffset = Math.max(tgOffset, u.update_id + 1);
    const m = u.message;
    const raw = m?.text?.trim();
    if (!m || !raw) continue;

    const lower = raw.toLowerCase();
    const isCommand = /^\/(stats|floor|price|agent)(@\w+)?(\s|$)/i.test(raw);
    const isMention = tgBotUsername ? lower.includes(`@${tgBotUsername}`) : false;
    const isReplyToBot = Boolean(
      tgBotUsername && m.reply_to_message?.from?.username?.toLowerCase() === tgBotUsername,
    );
    const isDm = m.chat.type === "private";
    if (!isCommand && !isMention && !isReplyToBot && !isDm) continue;

    // Match token by mapped chat ID, ticker in message, or single active token
    const chatKey = String(m.chat.id);
    const chatUser = m.chat.username ? `@${m.chat.username.toLowerCase()}` : "";
    let target =
      tokens.find((t) => TG_CHAT_MAP[t.token_id] === chatKey || (chatUser && resolveTelegramTargets(t).some((x) => x.toLowerCase() === chatUser))) ??
      tokens.find((t) => new RegExp(`\\$?\\b${t.meta.symbol}\\b`, "i").test(raw));
    if (!target && tokens.length === 1) target = tokens[0];
    if (!target) {
      await tgCall("sendMessage", {
        chat_id: m.chat.id,
        reply_to_message_id: m.message_id,
        text: `Mention a token ticker (e.g. /stats $${tokens[0].meta.symbol}) so I know which Floorpad token to check.`,
      });
      continue;
    }

    const prompt = raw.replace(new RegExp(`@${tgBotUsername}`, "gi"), "").trim().slice(0, 400);
    const reply = await generateReply(target, prompt || "Give a quick live update.");
    await tgCall("sendMessage", {
      chat_id: m.chat.id,
      reply_to_message_id: m.message_id,
      text: `${reply}\n\n${WEB_URL}/token/${target.token_id}`.slice(0, 4000),
      disable_web_page_preview: true,
    });
  }
}

// ---------------- X (Twitter) API v2 ----------------
const X_API_KEY = process.env.X_API_KEY ?? "";
const X_API_SECRET = process.env.X_API_SECRET ?? "";
const X_ACCESS_TOKEN = process.env.X_ACCESS_TOKEN ?? "";
const X_ACCESS_SECRET = process.env.X_ACCESS_SECRET ?? "";
const X_OAUTH2_TOKEN = process.env.X_OAUTH2_ACCESS_TOKEN ?? "";
const X_POST_MIN_SECS = Number(process.env.X_POST_MIN_SECS ?? "300");
const X_ALLOWLIST = (process.env.X_TOKEN_ALLOWLIST ?? "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

let lastXPostAt = 0;

const pctEnc = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function oauth1Header(method: string, url: string): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: X_API_KEY,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: X_ACCESS_TOKEN,
    oauth_version: "1.0",
  };
  const paramStr = Object.keys(oauth)
    .sort()
    .map((k) => `${pctEnc(k)}=${pctEnc(oauth[k])}`)
    .join("&");
  const baseStr = `${method.toUpperCase()}&${pctEnc(url)}&${pctEnc(paramStr)}`;
  const signingKey = `${pctEnc(X_API_SECRET)}&${pctEnc(X_ACCESS_SECRET)}`;
  oauth.oauth_signature = createHmac("sha1", signingKey).update(baseStr).digest("base64");
  const header = Object.keys(oauth)
    .sort()
    .map((k) => `${pctEnc(k)}="${pctEnc(oauth[k])}"`)
    .join(", ");
  return `OAuth ${header}`;
}

export async function postToX(t: AgentTokenInfo, text: string) {
  const hasOAuth1 = Boolean(X_API_KEY && X_API_SECRET && X_ACCESS_TOKEN && X_ACCESS_SECRET);
  if (!hasOAuth1 && !X_OAUTH2_TOKEN) return;
  if (!X_ALLOWLIST.includes("*") && !X_ALLOWLIST.includes(t.token_id) && !X_ALLOWLIST.includes(t.meta.symbol)) {
    return;
  }
  const now = Date.now() / 1000;
  if (now - lastXPostAt < X_POST_MIN_SECS) return;

  const link = `${WEB_URL}/token/${t.token_id}`;
  const suffix = `\n\n$${t.meta.symbol} · ${link}`;
  const maxBody = Math.max(40, 280 - suffix.length);
  const body = text.length > maxBody ? `${text.slice(0, maxBody - 1)}…` : text;
  const tweet = `${body}${suffix}`.slice(0, 280);

  const url = "https://api.twitter.com/2/tweets";
  const auth = hasOAuth1 ? oauth1Header("POST", url) : `Bearer ${X_OAUTH2_TOKEN}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: auth },
      body: JSON.stringify({ text: tweet }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.warn(`X post ${res.status}: ${await res.text()}`);
      return;
    }
    lastXPostAt = now;
    const data = (await res.json()) as { data?: { id?: string } };
    console.log(`✓ X tweet posted for $${t.meta.symbol}: id=${data.data?.id ?? "ok"}`);
  } catch (e) {
    console.warn("X post:", (e as Error).message);
  }
}
