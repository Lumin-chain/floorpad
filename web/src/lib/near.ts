// Config, JSON-RPC views, formatting and shared types.

export const NETWORK = (process.env.NEXT_PUBLIC_NETWORK ?? "testnet") as "testnet" | "mainnet";
export const RPC = process.env.NEXT_PUBLIC_RPC ?? `https://rpc.${NETWORK}.fastnear.com`;
export const LAUNCHPAD = process.env.NEXT_PUBLIC_LAUNCHPAD ?? "floorpad.testnet";
export const LINEAR =
  process.env.NEXT_PUBLIC_LINEAR ?? (NETWORK === "mainnet" ? "linear-protocol.near" : "linear-protocol.testnet");
export const REF =
  process.env.NEXT_PUBLIC_REF ?? (NETWORK === "mainnet" ? "v2.ref-finance.near" : "ref-finance-101.testnet");

export const YOCTO = 10n ** 24n;
export const TOKEN_DECIMALS = 18;
export const ONE_YOCTO = "1";
export const STORAGE_FEE = 1_250_000_000_000_000_000_000n; // 0.00125 NEAR
export const BUCKET_LABELS = ["Floor", "Buyback & burn", "Airdrop lockers", "AI agent", "DAO treasury"] as const;

let rpcId = 0;
async function rpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.data ?? json.error.message ?? "rpc error");
  if (json.result?.error) throw new Error(json.result.error);
  return json.result as T;
}

const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));

export async function view<T>(contract: string, method: string, args: object = {}): Promise<T> {
  const r = await rpc<{ result: number[] }>("query", {
    request_type: "call_function",
    finality: "optimistic",
    account_id: contract,
    method_name: method,
    args_base64: b64(JSON.stringify(args)),
  });
  const text = new TextDecoder().decode(new Uint8Array(r.result));
  return (text ? JSON.parse(text) : null) as T;
}

export async function viewAccount(account: string): Promise<{ amount: string; locked: string } | null> {
  try {
    return await rpc("query", { request_type: "view_account", finality: "optimistic", account_id: account });
  } catch {
    return null;
  }
}

export const lp = <T>(method: string, args: object = {}) => view<T>(LAUNCHPAD, method, args);

// ---------- formatting ----------

export function fmt(v: string | bigint | undefined | null, decimals = 24, dp = 4): string {
  if (v === undefined || v === null) return "–";
  const n = BigInt(v);
  const neg = n < 0n;
  const a = neg ? -n : n;
  const base = 10n ** BigInt(decimals);
  const whole = a / base;
  const frac = (a % base).toString().padStart(decimals, "0").slice(0, dp).replace(/0+$/, "");
  const w = whole.toLocaleString("en-US");
  return `${neg ? "-" : ""}${w}${frac ? "." + frac : ""}`;
}
export const fmtNear = (v?: string | bigint | null, dp = 4) => fmt(v, 24, dp);
export const fmtTok = (v?: string | bigint | null, dp = 2) => fmt(v, TOKEN_DECIMALS, dp);

export function compact(v: string | bigint, decimals: number): string {
  const n = Number(BigInt(v) / 10n ** BigInt(Math.max(0, decimals - 6))) / 1e6;
  return Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n);
}

/** Parse a decimal string ("1.5") to base units. */
export function parseUnits(s: string, decimals: number): bigint {
  const t = s.trim();
  if (!/^\d*\.?\d*$/.test(t) || t === "" || t === ".") return 0n;
  const [w, f = ""] = t.split(".");
  return BigInt(w || "0") * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
}

/** NEAR per whole token, as a JS number (display only). */
export function pricePerToken(nearYocto: bigint, tokensBase: bigint): number {
  if (tokensBase === 0n) return 0;
  // (near/1e24) / (tokens/1e18) = near / tokens / 1e6
  return Number((nearYocto * 10n ** 18n) / tokensBase) / 1e18 / 1e6;
}
export function fmtPrice(p: number): string {
  if (!isFinite(p) || p === 0) return "0";
  if (p >= 0.01) return p.toFixed(4);
  return p.toExponential(3);
}

export function ago(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
export function until(ts: number): string {
  const s = Math.floor(ts - Date.now() / 1000);
  if (s <= 0) return "now";
  if (s < 3600) return `in ${Math.ceil(s / 60)}m`;
  if (s < 86400) return `in ${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `in ${Math.floor(s / 86400)}d`;
}

// ---------- types (mirror the contract views) ----------

export type DaoStage = "Creating" | "Created" | "Finalizing" | "Ready" | "Failed";
export type GradStage = "Curve" | "CreatePool" | "Stake" | "Deposit" | "AddLiquidity" | "Graduated";

export interface TokenMeta {
  name: string;
  symbol: string;
  icon: string | null;
  description: string;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
}

export interface TokenView {
  index: number;
  token_id: string;
  creator: string;
  meta: TokenMeta;
  created_at: number;
  deployed: boolean;
  dao_id: string;
  dao_stage: DaoStage;
  v_near: string;
  v_tokens: string;
  sold: string;
  curve_supply: string;
  total_supply: string;
  real_near: string;
  burned: string;
  holders: number;
  volume_near: string;
  trade_count: number;
  backing_near: string;
  linear_shares: string;
  principal_near: string;
  creator_escrow: string;
  creator_released: string;
  creator_claimable: string;
  grad_mcap_usd: number;
  launch_near_usd: string;
  fdv_near: string;
  grad_fdv_near: string;
  grad_stage: GradStage;
  grad_busy: boolean;
  pool_id: number | null;
  lp_near: string;
  lp_shares: string;
  lp_tokens: string;
  graduated_at: number;
  total_locked: string;
  total_weight: string;
  alloc_tally: string[];
  stakers: number;
  epoch_index: number;
  last_epoch_at: number;
  next_epoch_at: number;
  epoch_busy: boolean;
  last_linear_price: string;
  agent_account: string;
  agent_persona: string;
  agent_budget_shares: string;
  post_count: number;
  snipe_window_ends: number;
}

export interface Position {
  amount: string;
  unlock_at: number;
  weight: string;
  alloc: number[] | null;
  reward_debt: string;
  pending_reward: string;
  delegated: string;
  dao_registered: boolean;
  sync_busy: boolean;
}

export interface Trade {
  ts: number;
  account: string;
  is_buy: boolean;
  near: string;
  tokens: string;
  v_near: string;
  v_tokens: string;
}
export interface Post {
  ts: number;
  text: string;
  paid: string;
}
export interface EpochReport {
  index: number;
  ts: number;
  price: string;
  yield_shares: string;
  split: string[];
  tally: string[];
}
export interface Quote {
  amount_out: string;
  fee: string;
  exit_fee: string;
  refund: string;
}
export interface MechEvent {
  ts: number;
  kind: string;
  amount: string;
  account: string | null;
}
export interface TradingAccount {
  near: string;
}
export interface Custody {
  amount: string;
  since: number;
}
export interface LaunchConfig {
  creation_fee: string;
  lock_min_days: number;
  lock_max_days: number;
  epoch_secs: number;
  max_exit_fee_bps: number;
  exit_decay_secs: number;
  redeem_fee_bps: number;
  buy_fee_bps: number;
  sell_fee_bps: number;
  fee_vault_bps: number;
  fee_creator_bps: number;
  creator_instant_bps: number;
  grad_mcap_usd: number;
  grad_vault_bps: number;
  grad_platform_bps: number;
  yield_platform_bps: number;
  referral_bps: number;
  snipe_max_tokens: string;
  linear: string;
  ref_exchange: string;
}

export const isGraduated = (t: TokenView) => t.grad_stage === "Graduated";

/** Spot price on the curve (NEAR per token). */
export const curvePrice = (t: TokenView) => pricePerToken(BigInt(t.v_near), BigInt(t.v_tokens));

/** Floor price (NEAR per token) – what one token redeems for before fees. */
export function floorPrice(t: TokenView, linearPrice?: bigint): number {
  if (isGraduated(t)) {
    const price = linearPrice ?? BigInt(t.last_linear_price || YOCTO.toString());
    const backing = (BigInt(t.linear_shares) * price) / YOCTO;
    return pricePerToken(backing, BigInt(t.total_supply) - BigInt(t.burned));
  }
  const circ = BigInt(t.sold) - BigInt(t.burned);
  return circ > 0n ? pricePerToken(BigInt(t.backing_near), circ) : 0;
}

export function vaultNear(t: TokenView, linearPrice?: bigint): bigint {
  if (isGraduated(t)) {
    const price = linearPrice ?? BigInt(t.last_linear_price || YOCTO.toString());
    return (BigInt(t.linear_shares) * price) / YOCTO;
  }
  return BigInt(t.backing_near);
}

export const progressPct = (t: TokenView) =>
  isGraduated(t) || t.grad_stage !== "Curve" ? 100 : Number((BigInt(t.sold) * 10000n) / BigInt(t.curve_supply)) / 100;

const REF_KEY = "floorpad.ref";
/** Remember `?ref=<account>` from a shared link (first touch wins for 30 days). */
export function captureReferrer() {
  if (typeof window === "undefined") return;
  const ref = new URLSearchParams(window.location.search).get("ref");
  if (!ref || !/^[a-z0-9._-]{2,64}$/.test(ref)) return;
  const cur = JSON.parse(localStorage.getItem(REF_KEY) ?? "null") as { id: string; at: number } | null;
  if (cur && Date.now() - cur.at < 30 * 86400_000) return;
  localStorage.setItem(REF_KEY, JSON.stringify({ id: ref, at: Date.now() }));
}
export function getReferrer(self: string | null): string | null {
  if (typeof window === "undefined") return null;
  const cur = JSON.parse(localStorage.getItem(REF_KEY) ?? "null") as { id: string } | null;
  return cur && cur.id !== self ? cur.id : null;
}

/** NEAR/USD as stored on-chain by the price feeder (used to size every launch). */
export async function nearUsd(): Promise<number> {
  const [micro] = await lp<[string, number]>("get_near_usd_price");
  return Number(micro) / 1e6;
}

/** yoctoNEAR -> USD number */
export const yoctoToUsd = (v: string | bigint, usd: number) => (Number(BigInt(v) / 10n ** 18n) / 1e6) * usd;
