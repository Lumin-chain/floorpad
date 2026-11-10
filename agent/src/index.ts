/**
 * Floorpad operator service.
 *
 * Keeper (permissionless, anyone can run one):
 *   - finalize_dao      for freshly created DAOs
 *   - advance_graduation for tokens whose curve sold out
 *   - settle_epoch       when an epoch is due
 *
 * Agent (only for tokens whose agent_account is OPERATOR_ID):
 *   - every POST_INTERVAL_SECS, writes a post in the token's voted persona,
 *     grounded in live on-chain stats, and publishes it with `agent_post`.
 *     After graduation each post is paid from the holder-voted agent budget;
 *     when the budget is empty the contract refuses and the agent sleeps.
 */
import os from "node:os";
import path from "node:path";
import { connect, keyStores, type Account } from "near-api-js";

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
const RPC = env("NEAR_RPC", `https://rpc.${NETWORK}.near.org`);
const LAUNCHPAD = env("LAUNCHPAD_ID");
const OPERATOR = env("OPERATOR_ID");
const AI_BASE = env("AI_BASE_URL", "https://cloud-api.near.ai/v1");
const AI_KEY = process.env.AI_API_KEY ?? "";
const AI_MODEL = env("AI_MODEL", "deepseek-ai/DeepSeek-V3.1");
const KEEPER_SECS = Number(env("KEEPER_INTERVAL_SECS", "60"));
const POST_SECS = Number(env("POST_INTERVAL_SECS", "1800"));
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
  epoch_busy: boolean;
  next_epoch_at: number;
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

const near = await connect({
  networkId: NETWORK,
  nodeUrl: RPC,
  keyStore: new keyStores.UnencryptedFileSystemKeyStore(path.join(os.homedir(), ".near-credentials")),
});
const operator: Account = await near.account(OPERATOR);

const view = <T>(method: string, args: object = {}) =>
  operator.viewFunction({ contractId: LAUNCHPAD, methodName: method, args }) as Promise<T>;

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
    if (t.grad_stage === "Graduated" && !t.epoch_busy && now >= t.next_epoch_at) {
      await call("settle_epoch", { token_id: t.token_id }, 300n);
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

// ---------------- main loop ----------------

async function tick() {
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
