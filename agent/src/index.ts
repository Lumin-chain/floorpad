/**
 * Floorpad operator service.
 *
 * Keeper (permissionless, anyone can run one):
 *   - finalize_dao      for freshly created DAOs
 *   - advance_graduation for tokens whose curve sold out
 *   - harvest_lp         when due (LP growth above the locked baseline -> burn + epoch yield)
 *   - settle_epoch       when an epoch is due (runs after the harvest so it splits it)
 *
 * Agent (only for tokens whose agent_account is OPERATOR_ID):
 *   - every POST_INTERVAL_SECS, writes a post in the token's voted persona,
 *     grounded in live on-chain stats, and publishes it with `agent_post`.
 *     After graduation each post is paid from the holder-voted agent budget;
 *     when the budget is empty the contract refuses and the agent sleeps.
 */
import os from "node:os";
import path from "node:path";
import { connect, KeyPair, keyStores, type Account } from "near-api-js";

try {
  process.loadEnvFile?.(".env");
} catch {
  /* no .env file: rely on the environment */
}

const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`missing env ${k}`);
  return v;
};

const NETWORK = env("NEAR_NETWORK", "testnet");
const RPC = env("NEAR_RPC", `https://rpc.${NETWORK}.fastnear.com`);
const LAUNCHPAD = env("LAUNCHPAD_ID");
const OPERATOR = env("OPERATOR_ID");
const AI_BASE = env("AI_BASE_URL", "https://cloud-api.near.ai/v1");
const AI_KEY = process.env.AI_API_KEY ?? "";
const AI_MODEL = env("AI_MODEL", "deepseek-ai/DeepSeek-V3.1");
const KEEPER_SECS = Number(env("KEEPER_INTERVAL_SECS", "60"));
const POST_SECS = Number(env("POST_INTERVAL_SECS", "1800"));
const TAX_HARVEST_MIN_NEAR = Number(env("TAX_HARVEST_MIN_NEAR", "2"));
const TAX_HARVEST_MIN_YOCTO = BigInt(Math.round(TAX_HARVEST_MIN_NEAR * 1e6)) * 10n ** 18n;
const ONCE = process.argv.includes("--once");

const TGAS = 10n ** 12n;
const YOCTO = 10n ** 24n;
const POST_DEPOSIT = 10n ** 22n; // 0.01 NEAR

type U128 = string;
interface TokenView {
  token_id: string;
  meta: { name: string; symbol: string; description: string };
  dao_stage: "Creating" | "Created" | "Finalizing" | "Ready" | "Failed";
  grad_stage: "Curve" | "CreatePool" | "Stake" | "Deposit" | "AddLiquidity" | "Graduated";
  grad_busy: boolean;
  pool_id: number | null;
  epoch_busy: boolean;
  next_epoch_at: number;
  harvest_busy?: boolean;
  harvest_pending?: boolean;
  next_harvest_at?: number;
  v_near: U128;
  v_tokens: U128;
  sold: U128;
  curve_supply: U128;
  holders: number;
  stakers: number;
  backing_near: U128;
  linear_shares: U128;
  principal_near: U128;
  burned: U128;
  total_supply: U128;
  agent_account: string;
  agent_persona: string;
  agent_budget_shares: U128;
  last_linear_price: U128;
  epoch_index: number;
}
interface Post {
  ts: number;
  text: string;
}

/**
 * Key source: OPERATOR_PRIVATE_KEY ("ed25519:...") for hosted deploys (Railway etc.),
 * otherwise ~/.near-credentials/<network>/<OPERATOR_ID>.json for local runs.
 * Use a dedicated low-balance account: it only pays gas and the 0.01 NEAR post deposit.
 */
async function operatorKeyStore() {
  const secret = process.env.OPERATOR_PRIVATE_KEY;
  if (secret) {
    const ks = new keyStores.InMemoryKeyStore();
    await ks.setKey(NETWORK, OPERATOR, KeyPair.fromString(secret as Parameters<typeof KeyPair.fromString>[0]));
    return ks;
  }
  return new keyStores.UnencryptedFileSystemKeyStore(path.join(os.homedir(), ".near-credentials"));
}

const near = await connect({
  networkId: NETWORK,
  nodeUrl: RPC,
  keyStore: await operatorKeyStore(),
});
const operator: Account = await near.account(OPERATOR);

const view = <T>(method: string, args: object = {}) =>
  operator.viewFunction({ contractId: LAUNCHPAD, methodName: method, args }) as Promise<T>;

const launchCfg = await view<{ ref_exchange: string; linear: string }>("get_config");

async function call(method: string, args: object, gasTgas: bigint, deposit = 0n) {
  const res = await operator.functionCall({
    contractId: LAUNCHPAD,
    methodName: method,
    args,
    gas: gasTgas * TGAS,
    attachedDeposit: deposit,
  });
  const failed = JSON.stringify(res.status).includes("Failure");
  console.log(`${failed ? "✗" : "✓"} ${method} ${JSON.stringify(args)} tx=${res.transaction.hash}`);
  return !failed;
}

async function allTokens(): Promise<TokenView[]> {
  const count = await view<number>("get_token_count");
  const out: TokenView[] = [];
  for (let from = 0; from < count; from += 100) {
    out.push(...(await view<TokenView[]>("get_tokens", { from_index: from, limit: 100 })));
  }
  return out;
}

// ---------------- keeper ----------------

async function keep(t: TokenView) {
  const now = Math.floor(Date.now() / 1000);
  try {
    if (t.dao_stage === "Created") {
      await call("finalize_dao", { token_id: t.token_id }, 200n);
    }
    if (t.grad_stage !== "Curve" && t.grad_stage !== "Graduated" && !t.grad_busy) {
      await call("advance_graduation", { token_id: t.token_id }, 300n);
    }
    const harvestDue = t.next_harvest_at !== undefined && (t.harvest_pending || now >= t.next_harvest_at);
    if (t.grad_stage === "Graduated" && !t.harvest_busy && harvestDue) {
      await call("harvest_lp", { token_id: t.token_id }, 300n).catch((e) => console.warn(`harvest ${t.token_id}:`, (e as Error).message));
    }
    if (t.grad_stage === "Graduated" && !t.epoch_busy && now >= t.next_epoch_at) {
      await call("settle_epoch", { token_id: t.token_id }, 300n);
    }
    if (t.grad_stage === "Graduated" && t.pool_id !== null) {
      const tax = await operator
        .viewFunction({ contractId: t.token_id, methodName: "get_tax", args: {} })
        .catch(() => null) as { pairs: string[]; pending_platform: string; pending_tax: string } | null;
      if (tax) {
        if (!tax.pairs.includes(launchCfg.ref_exchange)) {
          await call("ensure_dex_tax_pair", { token_id: t.token_id }, 30n).catch(() => {});
        }
        const pending = BigInt(tax.pending_platform || "0") + BigInt(tax.pending_tax || "0");
        if (pending > 0n) {
          const linOutStr = await operator
            .viewFunction({
              contractId: launchCfg.ref_exchange,
              methodName: "get_return",
              args: { pool_id: t.pool_id, token_in: t.token_id, amount_in: pending.toString(), token_out: launchCfg.linear },
            })
            .catch(() => "0") as string;
          const linOut = BigInt(linOutStr || "0");
          const linPrice = BigInt(t.last_linear_price || YOCTO.toString());
          const nearVal = (linOut * linPrice) / YOCTO;
          if (nearVal >= TAX_HARVEST_MIN_YOCTO) {
            await call("harvest_token_tax", { token_id: t.token_id }, 250n).catch((e) =>
              console.warn(`harvest_token_tax ${t.token_id}:`, (e as Error).message),
            );
          }
        }
      }
    }
  } catch (e) {
    console.warn(`keeper ${t.token_id}:`, (e as Error).message);
  }
}

// ---------------- agent ----------------

const fmt = (yocto: string | bigint, decimals = 24, dp = 4) => {
  const v = BigInt(yocto);
  const base = 10n ** BigInt(decimals);
  return `${v / base}.${(v % base).toString().padStart(decimals, "0").slice(0, dp)}`;
};

function stats(t: TokenView) {
  const price = Number(BigInt(t.v_near) * 10n ** 12n / BigInt(t.v_tokens)) / 1e18; // NEAR per token
  const circ = BigInt(t.total_supply) - BigInt(t.burned);
  const graduated = t.grad_stage === "Graduated";
  const backing = graduated
    ? (BigInt(t.linear_shares) * BigInt(t.last_linear_price || "1000000000000000000000000")) / YOCTO
    : BigInt(t.backing_near);
  const floor = Number((backing * 10n ** 12n) / (circ === 0n ? 1n : circ)) / 1e18 / 1e6;
  const progress = Number((BigInt(t.sold) * 10000n) / BigInt(t.curve_supply)) / 100;
  return {
    stage: graduated ? "graduated (trading on Ref, LP locked, earning staking yield)" : `bonding curve ${progress}% sold`,
    spot_price_near: graduated ? "see Ref pool" : price.toExponential(4),
    floor_price_near: floor.toExponential(4),
    vault_backing_near: fmt(backing),
    holders: t.holders,
    lockers: t.stakers,
    burned_tokens: fmt(t.burned, 18, 0),
    epochs_settled: t.epoch_index,
  };
}

async function writePost(t: TokenView, recent: Post[]): Promise<string | null> {
  if (!AI_KEY) {
    console.warn("AI_API_KEY not set; skipping post generation");
    return null;
  }
  const system = [
    t.agent_persona,
    `You are the community AI agent of the meme token $${t.meta.symbol} ("${t.meta.name}") on Floorpad (NEAR).`,
    "Holders vote on your persona and fund your inference budget from staking yield. Each post costs budget.",
    "Write ONE short post (max 280 characters). Use the live stats when relevant.",
    "Never promise profits, never give financial advice, never invent numbers.",
  ].join("\n");
  const user = [
    `Token description: ${t.meta.description}`,
    `Live stats: ${JSON.stringify(stats(t))}`,
    `Your last posts (do not repeat): ${recent.slice(0, 5).map((p) => p.text).join(" | ") || "none"}`,
  ].join("\n");
  const res = await fetch(`${AI_BASE}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${AI_KEY}` },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 200,
      temperature: 0.9,
    }),
  });
  if (!res.ok) {
    console.warn(`inference failed ${res.status}: ${await res.text()}`);
    return null;
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content?.trim();
  return text ? text.slice(0, 1000) : null;
}

const lastPost = new Map<string, number>();

async function agent(t: TokenView) {
  if (t.agent_account !== OPERATOR) return;
  const now = Date.now() / 1000;
  const recent = await view<Post[]>("get_posts", { token_id: t.token_id, limit: 5 });
  const last = Math.max(lastPost.get(t.token_id) ?? 0, recent[0]?.ts ?? 0);
  if (now - last < POST_SECS) return;
  if (t.grad_stage === "Graduated" && BigInt(t.agent_budget_shares) === 0n) {
    console.log(`${t.token_id}: agent budget empty, sleeping (holders can vote budget in)`);
    return;
  }
  const text = await writePost(t, recent);
  if (!text) return;
  lastPost.set(t.token_id, now);
  try {
    await call("agent_post", { token_id: t.token_id, text }, 30n, POST_DEPOSIT);
  } catch (e) {
    console.warn(`agent_post ${t.token_id}:`, (e as Error).message);
  }
}

// ---------------- NEAR/USD price feed ----------------
// New launches size their curve so they graduate at `grad_mcap_usd` at the
// NEAR/USD price stored on-chain. Two live sources must agree within 3%.

async function fetchJson(url: string) {
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
}

async function liveNearUsd(): Promise<number | null> {
  const [cg, bn] = await Promise.allSettled([
    fetchJson("https://api.coingecko.com/api/v3/simple/price?ids=near&vs_currencies=usd").then((j) => Number(j.near.usd)),
    fetchJson("https://api.binance.com/api/v3/ticker/price?symbol=NEARUSDT").then((j) => Number(j.price)),
  ]);
  const prices = [cg, bn].filter((p): p is PromiseFulfilledResult<number> => p.status === "fulfilled" && p.value > 0).map((p) => p.value);
  if (prices.length === 0) return null;
  if (prices.length === 2 && Math.abs(prices[0] - prices[1]) / prices[0] > 0.03) {
    console.warn(`price sources disagree: ${prices.join(" vs ")}; skipping update`);
    return null;
  }
  return prices.reduce((a, b) => a + b, 0) / prices.length;
}

async function pushPrice() {
  // Mainnet: the contract reads NEAR/USD from a Ref pool itself; the keeper just keeps
  // the reference warm (permissionless). Testnet (no price_pool): push a 2-source price.
  const cfg = await view<{ price_pool: unknown | null }>("get_config");
  if (cfg.price_pool) {
    const [, updatedAt] = await view<[string, number]>("get_near_usd_price");
    if (Date.now() / 1000 - updatedAt > 3600) await call("refresh_near_usd_price", {}, 50n);
    return;
  }
  const live = await liveNearUsd().catch(() => null);
  if (!live) return;
  const [onchain, updatedAt] = await view<[string, number]>("get_near_usd_price");
  const cur = Number(onchain) / 1e6;
  const age = Date.now() / 1000 - updatedAt;
  if (cur > 0 && Math.abs(live - cur) / cur < 0.005 && age < 3600) return;
  await call("set_near_usd_price", { price_micro_usd: Math.round(live * 1e6).toString() }, 10n);
}

// ---------------- main loop ----------------

async function tick() {
  await pushPrice().catch((e) => console.warn("price push failed:", (e as Error).message));
  const tokens = await allTokens();
  for (const t of tokens) {
    await keep(t);
    await agent(t);
  }
}

console.log(`floorpad operator ${OPERATOR} on ${NETWORK}, launchpad ${LAUNCHPAD}`);
do {
  try {
    await tick();
  } catch (e) {
    console.error("tick failed:", (e as Error).message);
  }
  if (!ONCE) await new Promise((r) => setTimeout(r, KEEPER_SECS * 1000));
} while (!ONCE);
