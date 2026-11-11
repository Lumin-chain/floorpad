// Minimal NEAR JSON-RPC reads + market-cap math shared by chat badges and callouts.

export const env = (k: string, d: string) => process.env[k] ?? d;
const NETWORK = env("NEAR_NETWORK", "testnet");
const RPC = env("NEAR_RPC", `https://rpc.${NETWORK}.fastnear.com`);
export const LAUNCHPAD = env("LAUNCHPAD_ID", "fplpmwbbcg00.testnet");
export const LINEAR = env("LINEAR_ID", NETWORK === "mainnet" ? "linear-protocol.near" : "linear-protocol.testnet");
export const REF = env("REF_ID", NETWORK === "mainnet" ? "v2.ref-finance.near" : "ref-finance-101.testnet");

let id = 0;
async function rpc<T>(method: string, params: unknown): Promise<T> {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
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

/** True if `publicKey` is a full-access key of `accountId` (NEP-413 requirement). */
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
}

const cache = new Map<string, { at: number; v: unknown }>();
export async function cached<T>(key: string, ttlMs: number, f: () => Promise<T>): Promise<T> {
  const c = cache.get(key);
  if (c && Date.now() - c.at < ttlMs) return c.v as T;
  const v = await f();
  cache.set(key, { at: Date.now(), v });
  return v;
}

export const getToken = (tokenId: string) =>
  cached(`tok:${tokenId}`, 15_000, () => view<TokenInfo | null>(LAUNCHPAD, "get_token", { token_id: tokenId }));

export const getTokens = (limit = 100) =>
  cached("all-tokens", 10_000, () => view<TokenInfo[]>(LAUNCHPAD, "get_tokens", { from_index: 0, limit }));

export interface OnChainTrade {
  ts: number;
  account: string;
  is_buy: boolean;
  near: string;
  tokens: string;
  v_near: string;
  v_tokens: string;
}

export function calcPrice(vNear: string, vTokens: string): number {
  const vn = BigInt(vNear);
  const vt = BigInt(vTokens);
  if (vt === 0n) return 0;
  return Number((vn * 10n ** 18n) / vt) / 1e18 / 1e6;
}

export const getTradesFrom = (tokenId: string, fromIndex: number, limit = 100) =>
  view<[number, OnChainTrade][]>(LAUNCHPAD, "get_trades_from", { token_id: tokenId, from_index: fromIndex, limit });

export const nearUsd = () =>
  cached("near-usd", 60_000, async () => {
    const [micro] = await view<[string, number]>(LAUNCHPAD, "get_near_usd_price");
    return Number(micro) / 1e6;
  });

const YOCTO = 10n ** 24n;

/** Fully-diluted market cap in NEAR and USD (curve spot price, or Ref pool price after graduation). */
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

/** Balance + locked share of supply, for chat badges. */
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
    return Number((held * 1_000_000n) / supply) / 10_000; // percent
  });
}
