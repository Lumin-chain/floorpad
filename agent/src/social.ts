/**
 * Social distribution & interactive group bot for Floorpad AI agents:
 *   - Telegram Bot API (@floorpadagentbot):
 *       * /link <SYMBOL|token_id>, /unlink (group admin only)
 *       * /buyalerts on|off, /setminbuy <NEAR> (group admin only)
 *       * /setrules <text>, /rules, /setwelcome <text>, /help
 *       * /stats, /floor, /price, /agent, @mentions -> AI replies with live stats
 *       * Live token buy alerts to linked groups & public @telegram handles
 *   - X (Twitter) API v2 tweet posting via OAuth 1.0a HMAC-SHA1 (or OAuth 2.0 bearer)
 * Zero runtime dependencies: uses Node's built-in fetch + node:crypto + node:fs.
 */
import fs from "node:fs";
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

export interface TradeInfo {
  ts: number;
  account: string;
  is_buy: boolean;
  near: string;
  tokens: string;
}

interface GroupConfig {
  token_id: string;
  buy_alerts: boolean;
  min_buy_near: number;
  rules?: string;
  welcome?: string;
}

const WEB_URL = (process.env.WEB_BASE_URL ?? "https://usefloorpad.fun").replace(/\/+$/, "");

// ---------------- Telegram ----------------
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const TG_DEFAULT_CHAT = process.env.TELEGRAM_DEFAULT_CHAT_ID ?? "";
const TG_STATE_PATH = process.env.TELEGRAM_STATE_PATH ?? "./telegram-groups.json";
const TG_CHAT_MAP: Record<string, string> = (() => {
  try {
    return JSON.parse(process.env.TELEGRAM_CHAT_MAP ?? "{}");
  } catch {
    return {};
  }
})();
const TG_POLL = process.env.TELEGRAM_POLL !== "0";

let tgOffset = 0;
let tgBotUsername = (process.env.TELEGRAM_BOT_USERNAME ?? "").replace(/^@/, "").toLowerCase();

function loadGroups(): Record<string, GroupConfig> {
  try {
    if (!fs.existsSync(TG_STATE_PATH)) return {};
    return JSON.parse(fs.readFileSync(TG_STATE_PATH, "utf8")) as Record<string, GroupConfig>;
  } catch {
    return {};
  }
}

function saveGroups(groups: Record<string, GroupConfig>) {
  try {
    fs.writeFileSync(TG_STATE_PATH, JSON.stringify(groups, null, 2));
  } catch (e) {
    console.warn("telegram groups save:", (e as Error).message);
  }
}

const groups: Record<string, GroupConfig> = loadGroups();

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

function resolveTelegramTargets(t: AgentTokenInfo, forBuyAlert = false): { chat_id: string; minBuyNear: number }[] {
  const out = new Map<string, number>();

  for (const [chatId, cfg] of Object.entries(groups)) {
    if (cfg.token_id === t.token_id) {
      if (!forBuyAlert || cfg.buy_alerts) {
        out.set(chatId, cfg.min_buy_near ?? 0);
      }
    }
  }

  const mapped = TG_CHAT_MAP[t.token_id] ?? TG_CHAT_MAP[t.meta.symbol.toUpperCase()];
  if (mapped && !out.has(mapped)) out.set(mapped, 0);
  if (TG_DEFAULT_CHAT && !out.has(TG_DEFAULT_CHAT)) out.set(TG_DEFAULT_CHAT, 0);

  const tgMeta = t.meta.telegram?.trim();
  if (tgMeta) {
    const handle = tgMeta
      .replace(/^https?:\/\/(t\.me|telegram\.me)\//i, "")
      .replace(/^@/, "")
      .split(/[/?#]/)[0];
    if (/^[a-zA-Z0-9_]{5,32}$/.test(handle) && !mapped) {
      const target = `@${handle}`;
      if (!out.has(target)) out.set(target, 0);
    }
  }
  return [...out.entries()].map(([chat_id, minBuyNear]) => ({ chat_id, minBuyNear }));
}

export async function postToTelegram(t: AgentTokenInfo, text: string) {
  if (!TG_TOKEN) return;
  const targets = resolveTelegramTargets(t, false);
  if (targets.length === 0) return;
  const msg = `$${t.meta.symbol} (${t.meta.name})\n\n${text}\n\n${WEB_URL}/token/${t.token_id}`;
  for (const { chat_id } of targets) {
    await tgCall("sendMessage", {
      chat_id,
      text: msg.slice(0, 4000),
      disable_web_page_preview: true,
    });
  }
}

export async function sendBuyAlert(t: AgentTokenInfo, trade: TradeInfo) {
  if (!TG_TOKEN || !trade.is_buy) return;
  const targets = resolveTelegramTargets(t, true);
  if (targets.length === 0) return;
  const nearSpent = Number(BigInt(trade.near) / 10n ** 18n) / 1e6;
  const tokensBought = Number(BigInt(trade.tokens) / 10n ** 18n);
  const stage = String(t.stats.stage ?? "");
  const msg = [
    `🟢 NEW $${t.meta.symbol} BUY!`,
    `Spent: ${nearSpent.toFixed(3)} NEAR`,
    `Bought: ${tokensBought.toLocaleString()} $${t.meta.symbol}`,
    `Buyer: ${trade.account}`,
    `Status: ${stage}`,
    `Floor: ${t.stats.floor_price_near ?? "–"} NEAR`,
    `Chart & Trade: ${WEB_URL}/token/${t.token_id}`,
  ].join("\n");

  for (const { chat_id, minBuyNear } of targets) {
    if (nearSpent < minBuyNear) continue;
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
    from?: { id: number; username?: string; first_name?: string };
    chat: { id: number; type: string; username?: string; title?: string };
    text?: string;
    new_chat_members?: { id: number; is_bot?: boolean; username?: string; first_name?: string }[];
    reply_to_message?: { from?: { is_bot?: boolean; username?: string } };
  };
}

async function isGroupAdmin(chatId: number, chatType: string, userId?: number): Promise<boolean> {
  if (chatType === "private" || chatType === "channel") return true;
  if (!userId) return false;
  const admins = await tgCall<{ user: { id: number } }[]>("getChatAdministrators", { chat_id: chatId });
  if (!admins) return false;
  return admins.some((a) => a.user.id === userId);
}

function findToken(tokens: AgentTokenInfo[], query: string): AgentTokenInfo | undefined {
  const q = query.trim().replace(/^\$/, "").toLowerCase();
  if (!q) return undefined;
  return (
    tokens.find((t) => t.token_id.toLowerCase() === q) ??
    tokens.find((t) => t.meta.symbol.toLowerCase() === q) ??
    tokens.find((t) => t.meta.name.toLowerCase() === q)
  );
}

const HELP_TEXT = (botName: string) =>
  [
    `🤖 Floorpad Agent (@${botName || "floorpadagentbot"})`,
    "",
    "Group Admin Setup:",
    "• /link <SYMBOL or token_id> — link this group to a Floorpad token",
    "• /buyalerts on|off — toggle live buy alerts",
    "• /setminbuy <NEAR> — minimum NEAR buy size to alert",
    "• /setrules <text> — set community group rules",
    "• /setwelcome <text> — set welcome message for new members",
    "• /unlink — disconnect this group",
    "",
    "Community Commands:",
    "• /rules — view group rules",
    "• /stats | /floor | /price — live token metrics & AI commentary",
    `• @${botName || "floorpadagentbot"} <question> — ask the token's AI agent`,
  ].join("\n");

export async function pollTelegramCommands(
  tokens: AgentTokenInfo[],
  generateReply: (t: AgentTokenInfo, question: string) => Promise<string>,
) {
  if (!TG_TOKEN || !TG_POLL || tokens.length === 0) return;
  if (!tgBotUsername) {
    const me = await tgCall<{ username?: string }>("getMe", {});
    tgBotUsername = me?.username?.toLowerCase() ?? "floorpadagentbot";
  }
  const updates = await tgCall<TgUpdate[]>("getUpdates", {
    offset: tgOffset,
    limit: 25,
    timeout: 0,
    allowed_updates: ["message"],
  });
  if (!updates?.length) return;

  for (const u of updates) {
    tgOffset = Math.max(tgOffset, u.update_id + 1);
    const m = u.message;
    if (!m) continue;

    const chatKey = String(m.chat.id);
    const linkedCfg = groups[chatKey];

    // Auto-greet new members if a welcome message is configured
    if (m.new_chat_members?.length && linkedCfg?.welcome) {
      const names = m.new_chat_members
        .filter((x) => !x.is_bot)
        .map((x) => (x.username ? `@${x.username}` : x.first_name || "frens"))
        .join(", ");
      if (names) {
        await tgCall("sendMessage", {
          chat_id: m.chat.id,
          text: `${linkedCfg.welcome}\n\nWelcome ${names}!`,
          disable_web_page_preview: true,
        });
      }
      continue;
    }

    const raw = m.text?.trim();
    if (!raw) continue;

    const reply = (text: string) =>
      tgCall("sendMessage", {
        chat_id: m.chat.id,
        reply_to_message_id: m.message_id,
        text: text.slice(0, 4000),
        disable_web_page_preview: true,
      });

    // Parse slash command (/cmd@bot args)
    const cmdMatch = raw.match(/^\/([a-zA-Z0-9_]+)(?:@([a-zA-Z0-9_]+))?(?:\s+([\s\S]*))?$/);
    if (cmdMatch) {
      const cmd = cmdMatch[1].toLowerCase();
      const targetBot = cmdMatch[2]?.toLowerCase();
      if (targetBot && tgBotUsername && targetBot !== tgBotUsername) continue;
      const arg = (cmdMatch[3] ?? "").trim();

      if (cmd === "start" || cmd === "help") {
        await reply(HELP_TEXT(tgBotUsername));
        continue;
      }

      if (cmd === "rules") {
        await reply(linkedCfg?.rules ? `📜 Group Rules:\n${linkedCfg.rules}` : "No group rules set yet. An admin can set them with /setrules <text>.");
        continue;
      }

      if (["link", "unlink", "buyalerts", "setminbuy", "setrules", "setwelcome"].includes(cmd)) {
        const admin = await isGroupAdmin(m.chat.id, m.chat.type, m.from?.id);
        if (!admin) {
          await reply("Only group admins can change Floorpad bot settings.");
          continue;
        }
        if (cmd === "link") {
          const tok = findToken(tokens, arg);
          if (!tok) {
            await reply(`Token not found for "${arg}". Usage: /link $SYMBOL or /link token.floorpad.near`);
            continue;
          }
          groups[chatKey] = {
            token_id: tok.token_id,
            buy_alerts: linkedCfg?.buy_alerts ?? true,
            min_buy_near: linkedCfg?.min_buy_near ?? 0,
            rules: linkedCfg?.rules,
            welcome: linkedCfg?.welcome,
          };
          saveGroups(groups);
          await reply(
            `✅ Linked this group to $${tok.meta.symbol} (${tok.token_id}).\nBuy alerts: ${groups[chatKey].buy_alerts ? "ON" : "OFF"} (min ${groups[chatKey].min_buy_near} NEAR).\nUse /setrules, /setwelcome, /setminbuy, or /stats anytime.`,
          );
          continue;
        }
        if (cmd === "unlink") {
          delete groups[chatKey];
          saveGroups(groups);
          await reply("Unlinked this group from Floorpad alerts.");
          continue;
        }
        if (!linkedCfg) {
          await reply("Link a token first with /link <SYMBOL>.");
          continue;
        }
        if (cmd === "buyalerts") {
          const on = arg.toLowerCase() === "on" || arg.toLowerCase() === "true";
          const off = arg.toLowerCase() === "off" || arg.toLowerCase() === "false";
          if (!on && !off) {
            await reply(`Buy alerts are currently ${linkedCfg.buy_alerts ? "ON" : "OFF"}. Use /buyalerts on or /buyalerts off.`);
            continue;
          }
          linkedCfg.buy_alerts = on;
          saveGroups(groups);
          await reply(`Buy alerts turned ${on ? "ON" : "OFF"} for this group.`);
          continue;
        }
        if (cmd === "setminbuy") {
          const min = Number(arg);
          if (Number.isNaN(min) || min < 0) {
            await reply("Usage: /setminbuy <NEAR> (e.g. /setminbuy 0.5)");
            continue;
          }
          linkedCfg.min_buy_near = min;
          saveGroups(groups);
          await reply(`Minimum buy alert set to ${min} NEAR.`);
          continue;
        }
        if (cmd === "setrules") {
          if (!arg) {
            await reply("Usage: /setrules <your group rules>");
            continue;
          }
          linkedCfg.rules = arg.slice(0, 1500);
          saveGroups(groups);
          await reply("✅ Group rules updated. Members can view them anytime with /rules.");
          continue;
        }
        if (cmd === "setwelcome") {
          if (!arg) {
            await reply("Usage: /setwelcome <welcome message>");
            continue;
          }
          linkedCfg.welcome = arg.slice(0, 800);
          saveGroups(groups);
          await reply("✅ Welcome message updated for new group members.");
          continue;
        }
      }
    }

    // AI & Stats queries (/stats, /floor, /price, /agent, @mention, reply, DM)
    const lower = raw.toLowerCase();
    const isStatsCmd = /^\/(stats|floor|price|agent)(@\w+)?(\s|$)/i.test(raw);
    const isMention = tgBotUsername ? lower.includes(`@${tgBotUsername}`) : false;
    const isReplyToBot = Boolean(
      tgBotUsername && m.reply_to_message?.from?.username?.toLowerCase() === tgBotUsername,
    );
    const isDm = m.chat.type === "private";
    if (!isStatsCmd && !isMention && !isReplyToBot && !isDm) continue;

    const chatUser = m.chat.username ? `@${m.chat.username.toLowerCase()}` : "";
    let target =
      (linkedCfg ? tokens.find((t) => t.token_id === linkedCfg.token_id) : undefined) ??
      tokens.find(
        (t) =>
          TG_CHAT_MAP[t.token_id] === chatKey ||
          (chatUser && resolveTelegramTargets(t, false).some((x) => x.chat_id.toLowerCase() === chatUser)),
      ) ??
      tokens.find((t) => new RegExp(`\\$?\\b${t.meta.symbol}\\b`, "i").test(raw));
    if (!target && tokens.length === 1) target = tokens[0];
    if (!target) {
      await reply(`Link this group with /link $${tokens[0].meta.symbol} or mention a ticker (e.g. /stats $${tokens[0].meta.symbol}).`);
      continue;
    }

    const prompt = raw.replace(new RegExp(`@${tgBotUsername}`, "gi"), "").trim().slice(0, 400);
    const aiReply = await generateReply(target, prompt || "Give a quick live update.");
    await reply(`${aiReply}\n\n${WEB_URL}/token/${target.token_id}`);
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
