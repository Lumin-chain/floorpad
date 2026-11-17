/**
 * Telegram trade alerts: layout, size tiers and the buy roasts.
 *
 * Pure functions (no I/O) so the format can be previewed and tested without a bot.
 * Output is Telegram HTML (`parse_mode: "HTML"`); every interpolated value is escaped.
 */

export interface AlertTrade {
  isBuy: boolean;
  /** NEAR spent (buy) or received (sell). */
  near: number;
  /** Whole tokens bought or sold. */
  tokens: number;
  account: string;
  /** Wallet NEAR balance after the trade, when it could be read. */
  balanceLeft?: number | null;
  txHash?: string | null;
}

export interface AlertToken {
  tokenId: string;
  symbol: string;
  venue: "curve" | "ref";
  graduated: boolean;
  /** Bonding-curve progress in percent (pre-graduation). */
  curvePct?: number | null;
  /** Circulating supply in whole tokens (total minus burned). */
  circulating?: number | null;
  /** Spot price after the trade, NEAR per token: Ref pool (graduated) or curve, as the website shows it. */
  spotPriceNear?: number | null;
  /** Market cap in NEAR, computed exactly like the website's (`tokenFdvNear`). */
  mcapNear?: number | null;
  /** Floor vault in NEAR (the website's "Floor (vault)" chip). */
  vaultNear?: number | null;
  /** NEAR/USD used for the USD figures (the same fresh price the website uses). */
  nearUsd?: number | null;
  holders?: number | null;
}

export interface AlertLinks {
  webUrl: string;
  explorerUrl: string;
}

// ---------- size tiers ----------

interface Tier {
  min: number;
  emoji: string;
  name: string;
}

/** Buy size tiers by NEAR spent, smallest first. */
export const TIERS: Tier[] = [
  { min: 0, emoji: "🦐", name: "Shrimp" },
  { min: 1, emoji: "🐟", name: "Fish" },
  { min: 5, emoji: "🐬", name: "Dolphin" },
  { min: 20, emoji: "🦈", name: "Shark" },
  { min: 100, emoji: "🐋", name: "Whale" },
];

export function tierFor(near: number): Tier {
  let t = TIERS[0];
  for (const x of TIERS) if (near >= x.min) t = x;
  return t;
}

/** A bar of dots that grows with trade size (1 dot for dust, up to 20 for whales). */
export function sizeBar(near: number, isBuy: boolean): string {
  const n = Math.max(1, Math.min(20, Math.round(Math.sqrt(Math.max(near, 0)) * 3)));
  return (isBuy ? "🟢" : "🔴").repeat(n);
}

// ---------- number formatting ----------

export function compactNum(v: number): string {
  if (!Number.isFinite(v)) return "–";
  const a = Math.abs(v);
  if (a >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(a >= 1 ? 2 : 4).replace(/\.?0+$/, "") || "0";
}

export function fmtNear(v: number): string {
  if (!Number.isFinite(v)) return "–";
  if (v >= 1000) return compactNum(v);
  if (v >= 1) return v.toFixed(2);
  if (v >= 0.01) return v.toFixed(3);
  return v.toPrecision(2);
}

/** Tiny prices without scientific notation: 0.0₆3132 style is unreadable in TG, so use plain digits. */
export function fmtPrice(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return "–";
  if (v >= 0.01) return v.toFixed(4);
  const zeros = Math.floor(-Math.log10(v));
  return v.toFixed(Math.min(zeros + 4, 20)).replace(/0+$/, "");
}

export function fmtUsd(v: number): string {
  if (!Number.isFinite(v)) return "–";
  if (v >= 1000) return `$${compactNum(v)}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(3)}`;
  return `$${fmtPrice(v)}`;
}

/** "$1.2K · 380 NEAR", or just the NEAR figure when no USD price is known. */
function usdAndNear(near: number, usd: number | null | undefined): string {
  return usd ? `<b>${fmtUsd(near * usd)}</b> · ${fmtNear(near)} NEAR` : `<b>${fmtNear(near)} NEAR</b>`;
}

export function shortAccount(a: string, max = 24): string {
  if (a.length <= max) return a;
  const parts = a.split(".");
  const tail = parts.length > 1 ? parts[parts.length - 1] : a.slice(-6);
  return `${a.slice(0, Math.max(6, max - tail.length - 1))}…${tail}`;
}

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---------- roasts ----------

/**
 * Sarcastic one-liners for buys, picked from the buy size and how much of the wallet it used.
 * Playful, never financial advice, never promises returns. `{spent}`, `{left}`, `{pct}`, `{sym}`
 * are filled in.
 */
const ROASTS = {
  // spent at least 90% of the wallet
  allIn: [
    "{spent} NEAR in, {left} NEAR left. Rent is a social construct anyway.",
    "Went {pct}% of the wallet in one click. Risk management has left the chat.",
    "{left} NEAR left for gas. Hope you like walking.",
    "That's not a position, that's a personality now.",
    "Sold the couch for ${sym}? Bold. Sit on the floor, it's literally the theme.",
  ],
  // spent at least half the wallet
  heavy: [
    "{pct}% of the wallet on ${sym}. Diversification is for people with plans.",
    "Half the bag in one buy. Your future self is already typing the group chat essay.",
    "{spent} NEAR in, {left} left. Confidence or caffeine, we can't tell.",
    "Bold allocation. The floor appreciates your sacrifice.",
  ],
  whale: [
    "A whale has entered. Everyone act natural.",
    "{spent} NEAR in one go. The chart just felt that.",
    "Somebody check if the pool is still standing.",
    "Big buy. Big feelings. Bigger screenshots incoming.",
  ],
  big: [
    "{spent} NEAR. Not a whale yet, but definitely moist.",
    "Solid buy. Someone's been reading the docs. Or not. Either way.",
    "That's a real bag. Welcome to the floor, mind the slabs.",
  ],
  // wallet barely touched
  pocketChange: [
    "Used {pct}% of the wallet. Testing the water with a teaspoon, I see.",
    "{left} NEAR still sitting there doing nothing. Interesting strategy.",
    "Rich wallet, tiny buy. The hedge-fund-of-one approach.",
  ],
  shrimp: [
    "{spent} NEAR. Every whale was a shrimp once. Most stayed shrimp.",
    "Bought with what was under the sofa cushions. Respect.",
    "A buy so small the chart needed glasses.",
    "Dipping a toe. The floor is warm, come on in.",
    "Shrimp buy detected. Small but brave.",
  ],
  mid: [
    "{spent} NEAR on ${sym}. Neither shrimp nor whale. Just vibes.",
    "Sensible-sized buy. Suspiciously responsible for this chain.",
    "A perfectly average bag. The floor nods politely.",
  ],
};

function pick<T>(list: T[], seed: string): T {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return list[Math.abs(h) % list.length];
}

export function buyRoast(trade: AlertTrade, symbol: string, seed = ""): string {
  const spent = trade.near;
  const left = trade.balanceLeft ?? null;
  const share = left !== null && spent + left > 0 ? spent / (spent + left) : null;
  let pool: string[];
  if (share !== null && share >= 0.9 && spent >= 0.2) pool = ROASTS.allIn;
  else if (share !== null && share >= 0.5 && spent >= 0.2) pool = ROASTS.heavy;
  else if (spent >= 100) pool = ROASTS.whale;
  else if (spent >= 20) pool = ROASTS.big;
  else if (share !== null && share < 0.02 && (left ?? 0) >= 50) pool = ROASTS.pocketChange;
  else if (spent < 1) pool = ROASTS.shrimp;
  else pool = ROASTS.mid;
  const line = pick(pool, `${seed}|${trade.account}|${spent}`);
  return line
    .replace(/\{spent\}/g, fmtNear(spent))
    .replace(/\{left\}/g, left === null ? "?" : fmtNear(left))
    .replace(/\{pct\}/g, share === null ? "?" : String(Math.round(share * 100)))
    .replace(/\{sym\}/g, symbol);
}

// ---------- message ----------

export interface TelegramAlert {
  text: string;
  reply_markup: { inline_keyboard: { text: string; url: string }[][] };
}

export function formatTradeAlert(tok: AlertToken, trade: AlertTrade, links: AlertLinks): TelegramAlert {
  const sym = esc(tok.symbol);
  const tier = tierFor(trade.near);
  const fillPrice = trade.tokens > 0 ? trade.near / trade.tokens : 0;
  const price = tok.spotPriceNear && tok.spotPriceNear > 0 ? tok.spotPriceNear : fillPrice;
  const mcap = tok.mcapNear ?? (tok.circulating && price > 0 ? tok.circulating * price : null);
  const venue = tok.venue === "ref" ? "Ref Finance" : "Bonding curve";
  const acct = esc(shortAccount(trade.account));
  const acctUrl = `${links.explorerUrl}/address/${encodeURIComponent(trade.account)}`;

  const lines: string[] = [];
  if (trade.isBuy) {
    lines.push(`${tier.emoji} <b>$${sym} BUY</b> · ${tier.name}`);
  } else {
    lines.push(`🔻 <b>$${sym} SELL</b>`);
  }
  lines.push(sizeBar(trade.near, trade.isBuy));
  lines.push("");
  lines.push(
    trade.isBuy
      ? `💸 <b>${fmtNear(trade.near)} NEAR</b> → <b>${compactNum(trade.tokens)}</b> $${sym}`
      : `💸 <b>${compactNum(trade.tokens)}</b> $${sym} → <b>${fmtNear(trade.near)} NEAR</b>`,
  );
  lines.push(
    `🏷 Price  <code>${fmtPrice(price)}</code> NEAR` + (tok.nearUsd ? ` (${fmtUsd(price * tok.nearUsd)})` : ""),
  );
  if (mcap !== null) lines.push(`📊 MCap  ${usdAndNear(mcap, tok.nearUsd)}`);
  if (tok.vaultNear && tok.vaultNear > 0) lines.push(`🧱 Floor vault  ${usdAndNear(tok.vaultNear, tok.nearUsd)}`);
  lines.push(
    `👤 <a href="${esc(acctUrl)}">${acct}</a>` +
      (trade.balanceLeft !== null && trade.balanceLeft !== undefined ? ` · 👛 ${fmtNear(trade.balanceLeft)} NEAR left` : ""),
  );
  lines.push(
    tok.graduated
      ? `🎓 Graduated · ${venue} · LP locked`
      : `📈 ${venue}${tok.curvePct !== null && tok.curvePct !== undefined ? ` · ${tok.curvePct.toFixed(1)}% to graduation` : ""}`,
  );
  if (tok.holders) lines[lines.length - 1] += ` · ${tok.holders} holders`;
  if (trade.isBuy) {
    lines.push("");
    lines.push(`<i>${esc(buyRoast(trade, tok.symbol, trade.txHash ?? ""))}</i>`);
  }

  const tokenUrl = `${links.webUrl}/token/${encodeURIComponent(tok.tokenId)}`;
  const row: { text: string; url: string }[] = [{ text: "📈 Chart & Trade", url: tokenUrl }];
  if (trade.txHash) row.push({ text: "🧾 Tx", url: `${links.explorerUrl}/txns/${encodeURIComponent(trade.txHash)}` });
  return { text: lines.join("\n"), reply_markup: { inline_keyboard: [row] } };
}

// ---------- milestone posts (launch, graduation, harvests) ----------

export type Milestone =
  | { kind: "launch"; name: string; creator: string; gradMcapUsd: number }
  | { kind: "graduated"; poolId: number | null; secsToGraduate: number | null }
  | { kind: "lp_harvest"; burnedTokens: number; linearAdded: number; sinceSecs: number }
  | {
      kind: "tax_harvest";
      burnedTokens: number | null;
      /** Floor vault (NEAR) and floor per token (NEAR) just before and after the harvest. */
      vaultBefore?: number | null;
      vaultAfter?: number | null;
      floorBefore?: number | null;
      floorAfter?: number | null;
    };

export interface MilestonePost {
  /** Telegram HTML. */
  text: string;
  /** Plain text for X. */
  plain: string;
  reply_markup: { inline_keyboard: { text: string; url: string }[][] };
}

const RULE = "━━━━━━━━━━━━━━";

export function fmtDuration(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

/** Platform-written milestone posts; only the token's validated name/ticker is interpolated. */
export function formatMilestone(tok: AlertToken, m: Milestone, links: AlertLinks & { refUrl?: string }): MilestonePost {
  const sym = esc(tok.symbol);
  const tokenUrl = `${links.webUrl}/token/${encodeURIComponent(tok.tokenId)}`;
  const vault = tok.vaultNear && tok.vaultNear > 0 ? usdAndNear(tok.vaultNear, tok.nearUsd) : null;
  const mcap = tok.mcapNear ? usdAndNear(tok.mcapNear, tok.nearUsd) : null;
  const lines: string[] = [];
  const plain: string[] = [];
  let buttons: { text: string; url: string }[] = [{ text: "📈 Chart & Trade", url: tokenUrl }];

  if (m.kind === "launch") {
    const name = esc(m.name);
    lines.push("🚀 <b>NEW LAUNCH ON FLOORPAD</b>", `<b>${name}</b> · $${sym}`, RULE);
    lines.push("🧱 Redeemable floor active from the first buy");
    lines.push(`🎯 Graduates to Ref Finance at <b>$${m.gradMcapUsd}</b> market cap`);
    lines.push("🔒 100% of LP locked forever on graduation");
    lines.push(`👤 Creator <a href="${esc(`${links.explorerUrl}/address/${encodeURIComponent(m.creator)}`)}">${esc(shortAccount(m.creator))}</a>`);
    buttons = [{ text: `🟢 Buy $${tok.symbol}`, url: tokenUrl }];
    plain.push(`🚀 New launch on Floorpad: ${m.name} ($${tok.symbol})`, "Floor active from the first buy. 100% LP locked on graduation.", tokenUrl);
  } else if (m.kind === "graduated") {
    lines.push(`🎓 <b>$${sym} GRADUATED</b>`, "Bonding curve sold out → now trading on Ref Finance", RULE);
    lines.push("🔒 100% of LP locked forever");
    if (vault) lines.push(`🧱 Floor vault  ${vault} · earning staking yield`);
    if (mcap) lines.push(`📊 MCap  ${mcap}`);
    if (m.secsToGraduate !== null) lines.push(`⏱ Graduated <b>${fmtDuration(m.secsToGraduate)}</b> after launch`);
    if (links.refUrl) buttons.push({ text: m.poolId !== null ? `🏊 Ref pool #${m.poolId}` : "🏊 Ref pool", url: links.refUrl });
    plain.push(`🎓 $${tok.symbol} graduated to Ref Finance. 100% of LP locked forever, floor vault earning staking yield.`, tokenUrl);
  } else if (m.kind === "lp_harvest") {
    lines.push(`🔥 <b>$${sym} LP HARVEST</b>`, `Pool fees collected over the last ${fmtDuration(m.sinceSecs)}`, RULE);
    lines.push(`🔥 Burned <b>${compactNum(m.burnedTokens)}</b> $${sym}`);
    if (m.linearAdded > 0) lines.push(`💧 +<b>${fmtNear(m.linearAdded)}</b> LiNEAR to staking yield`);
    if (tok.circulating) lines.push(`📉 Supply now ${compactNum(tok.circulating)} $${sym}`);
    if (vault) lines.push(`🧱 Floor vault  ${vault}`);
    lines.push("", "<i>Fees in, supply out. The floor only goes one way.</i>");
    plain.push(`🔥 $${tok.symbol} LP harvest: ${compactNum(m.burnedTokens)} burned, fees added to the floor's staking yield.`, tokenUrl);
  } else {
    lines.push(`💰 <b>$${sym} DEX TAX HARVEST</b>`, "Trading tax swapped into the floor", RULE);
    const vb = m.vaultBefore ?? null;
    const va = m.vaultAfter ?? null;
    if (vb !== null && va !== null) {
      const pct = vb > 0 ? ((va - vb) / vb) * 100 : null;
      const change = va > vb ? ` <b>(+${pct !== null ? `${pct.toFixed(pct < 1 ? 2 : 1)}%` : fmtNear(va - vb)})</b>` : " (unchanged so far)";
      lines.push(`🧱 Floor vault  ${fmtNear(vb)} → <b>${fmtNear(va)}</b> NEAR${change}`);
      if (tok.nearUsd) lines.push(`      ${fmtUsd(vb * tok.nearUsd)} → ${fmtUsd(va * tok.nearUsd)}`);
      if (m.floorBefore && m.floorAfter) {
        lines.push(`🏷 Floor per token  <code>${fmtPrice(m.floorBefore)}</code> → <code>${fmtPrice(m.floorAfter)}</code> NEAR`);
      }
      plain.push(
        `💰 $${tok.symbol} DEX tax harvested: floor vault ${fmtNear(vb)} → ${fmtNear(va)} NEAR${pct !== null && va > vb ? ` (+${pct.toFixed(1)}%)` : ""}.`,
        tokenUrl,
      );
    } else {
      lines.push(vault ? `🧱 Floor vault topped up  ${vault}` : "🧱 Floor vault topped up");
      plain.push(`💰 $${tok.symbol} DEX tax harvested: floor vault topped up.`, tokenUrl);
    }
    if (m.burnedTokens) lines.push(`🔥 Burned <b>${compactNum(m.burnedTokens)}</b> $${sym}`);
    if (va !== null && vb !== null && va > vb) lines.push("", "<i>Every trade pays the floor. Up only.</i>");
  }
  return { text: lines.join("\n"), plain: plain.join("\n"), reply_markup: { inline_keyboard: [buttons] } };
}
