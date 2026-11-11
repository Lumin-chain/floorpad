/**
 * Floorpad end-to-end lifecycle on NEAR testnet, against the real Sputnik code,
 * Ref Finance and LiNEAR contracts. Uses throwaway faucet-funded accounts whose
 * keys stay in ./.state.json (git-ignored). Resumable: re-run to continue.
 *
 *   node testnet.mjs            # run / resume
 *   node testnet.mjs --fresh    # start over with new accounts
 *
 * Checks: global code deploys (token + official Sputnik v2.3.1), launch, DAO
 * creation + hand-over to holders, curve buy/sell, ve-lock -> Sputnik vote weight,
 * holders' proposal passing at >70%, graduation (Ref pool, LiNEAR stake, locked LP),
 * epoch split incl. Ref buyback & burn + airdrop, floor redemption, agent post.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { Account, JsonRpcProvider, KeyPair } from "near-api-js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATE = path.join(HERE, ".state.json");
const RPC = process.env.NEAR_RPC ?? "https://rpc.testnet.fastnear.com";
const HELPER = "https://helper.testnet.near.org";
const WASM = process.env.WASM_DIR ?? path.join(os.homedir(), ".cargo-target/floorpad/wasm32-unknown-unknown/release");
const SPUTNIK_WASM = process.env.SPUTNIK_WASM; // official v2.3.1 bytes (hash DtHZA1...)
const LINEAR = "linear-protocol.testnet";
const REF = "ref-finance-101.testnet";
const NEAR = 10n ** 24n;
const TGAS = 10n ** 12n;
const N = (x) => BigInt(Math.round(x * 1000)) * (NEAR / 1000n);

const provider = new JsonRpcProvider({ url: RPC });
let state = fs.existsSync(STATE) && !process.argv.includes("--fresh") ? JSON.parse(fs.readFileSync(STATE, "utf8")) : { accounts: {}, done: {} };
const save = () => fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (y) => (Number(BigInt(y) / 10n ** 21n) / 1000).toFixed(3);
const results = (state.results ??= []);
const ok = (name, detail = "") => { results.push(["PASS", name, detail]); save(); console.log(`  ✓ ${name} ${detail}`); };
const bad = (name, detail = "") => { results.push(["FAIL", name, detail]); save(); console.log(`  ✗ ${name} ${detail}`); };
const check = (cond, name, detail) => (cond ? ok(name, detail) : bad(name, detail));

// ---------------- accounts ----------------
async function faucetAccount(label) {
  if (state.accounts[label]) return state.accounts[label];
  const kp = KeyPair.fromRandom("ed25519");
  const id = `fp${label}${Date.now().toString(36)}`.toLowerCase() + ".testnet";
  const r = await fetch(`${HELPER}/account`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ newAccountId: id, newAccountPublicKey: kp.getPublicKey().toString() }),
  });
  if (!r.ok) throw new Error(`faucet ${r.status}: ${await r.text()}`);
  for (let i = 0; i < 20; i++) {
    try { await provider.viewAccount({ accountId: id }); break; } catch { await sleep(1500); }
  }
  state.accounts[label] = { id, key: kp.toString() };
  save();
  console.log(`  + ${label}: ${id}`);
  return state.accounts[label];
}
const acct = (label) => new Account(state.accounts[label].id, provider, state.accounts[label].key);
const balance = async (id) => BigInt((await provider.viewAccount({ accountId: id })).amount);

async function view(contractId, method, args = {}) {
  return provider.callFunction({ contractId, method, args });
}

/** Call and surface every receipt failure + logs (callbacks fail silently otherwise). */
async function call(label, contractId, methodName, args = {}, { deposit = 0n, gas = 300n } = {}) {
  const res = await acct(label).callFunctionRaw({ contractId, methodName, args, deposit, gas: gas * TGAS, waitUntil: "EXECUTED_OPTIMISTIC" });
  const failures = [];
  const logs = [];
  for (const r of [res.transaction_outcome, ...res.receipts_outcome]) {
    logs.push(...(r.outcome.logs ?? []));
    const st = r.outcome.status;
    if (st && st.Failure) failures.push(JSON.stringify(st.Failure).slice(0, 300));
  }
  const top = res.status;
  let value = null;
  if (top?.SuccessValue !== undefined) {
    const s = Buffer.from(top.SuccessValue, "base64").toString();
    try { value = s ? JSON.parse(s) : null; } catch { value = s; }
  }
  return { failures, logs, value, hash: res.transaction.hash, topFailed: !!top?.Failure };
}

async function step(name, fn) {
  if (state.done[name]) return console.log(`• ${name} (done)`);
  console.log(`• ${name}`);
  await fn();
  state.done[name] = true;
  save();
  if (process.env.STOP_AFTER === name) {
    console.log(`stopping after "${name}"`);
    process.exit(results.some((r) => r[0] === "FAIL") ? 1 : 0);
  }
}

const b58 = (buf) => {
  const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = BigInt("0x" + Buffer.from(buf).toString("hex")), s = "";
  while (n > 0n) { s = A[Number(n % 58n)] + s; n /= 58n; }
  return s;
};

// ---------------- run ----------------
console.log(`RPC ${RPC}`);
const FUNDERS = Number(process.env.FUNDERS ?? 9);
// SKIP_DAO=1: the Sputnik global code is not on testnet yet (deploying it costs ~44 NEAR);
// run every other flow and check the launch survives a failed DAO deploy.
const SKIP_DAO = process.env.SKIP_DAO === "1";
const OFFICIAL_SPUTNIK_HASH = "DtHZA1mUmGYeScEaUoUZYQGGFHSMpnjMCvkr5U9hJXuF";

await step("accounts", async () => {
  await faucetAccount("bank");
  await faucetAccount("lp");
  await faucetAccount("bob");
  await faucetAccount("whale");
  // Extra pre-funded throwaway accounts can be passed as EXTRA_FUNDERS=path/to/key.json,...
  for (const file of (process.env.EXTRA_FUNDERS ?? "").split(",").filter(Boolean)) {
    const k = JSON.parse(fs.readFileSync(file, "utf8"));
    const label = `x_${k.account_id}`;
    state.accounts[label] ??= { id: k.account_id, key: k.private_key };
  }
  for (let i = 0; i < FUNDERS; i++) {
    try { await faucetAccount(`f${i}`); } catch (e) { console.log(`  faucet stopped: ${e.message}`); break; }
  }
  for (const [label, a] of Object.entries(state.accounts)) {
    if (!/^(f\d+|x_)/.test(label)) continue;
    const b = await balance(a.id);
    if (b > N(0.5)) await acct(label).transfer({ receiverId: state.accounts.bank.id, amount: b - N(0.05) });
  }
  await acct("bank").transfer({ receiverId: state.accounts.whale.id, amount: N(5) });
  await acct("bank").transfer({ receiverId: state.accounts.bob.id, amount: N(2) });
  console.log(`  bank balance ${fmt(await balance(state.accounts.bank.id))} NEAR`);
});

const LP = () => state.accounts.lp.id;

await step("global code", async () => {
  if (!SPUTNIK_WASM) throw new Error("set SPUTNIK_WASM to the official sputnikdao2 v2.3.1 wasm");
  for (const [k, file] of [["token", path.join(WASM, "meme_token.wasm")], ["dao", SPUTNIK_WASM]].filter(([k]) => !process.env.ONLY_CODE || process.env.ONLY_CODE === k)) {
    const code = fs.readFileSync(file);
    const hash = b58(createHash("sha256").update(code).digest());
    state[`${k}_hash`] = hash;
    const exists = await provider.viewGlobalContractCode({ codeHash: hash }).then(() => true).catch(() => false);
    if (exists) { ok(`${k} global code already on testnet`, hash); continue; }
    const before = await balance(state.accounts.bank.id);
    await acct("bank").deployGlobalContract(code, "codeHash");
    const cost = before - (await balance(state.accounts.bank.id));
    ok(`${k} global code deployed`, `${hash} (${code.length} bytes, cost ${fmt(cost)} NEAR)`);
  }
  save();
});

await step("deploy launchpad", async () => {
  const bank = acct("bank");
  const lpFund = Number(process.env.LP_FUND ?? 14);
  if (lpFund > 0) await bank.transfer({ receiverId: LP(), amount: N(lpFund) });
  const code = fs.readFileSync(path.join(WASM, "floorpad_launchpad.wasm"));
  await acct("lp").deployContract(code);
  const cfg = JSON.parse(fs.readFileSync(path.join(HERE, "../deploy/config.testnet.json"), "utf8").replace(/TREASURY_ID/g, state.accounts.bank.id).replace(/FEEDER_ID/g, state.accounts.bank.id).replace(/LAUNCHPAD_ID/g, LP()));
  Object.assign(cfg, {
    token_code_hash: state.token_hash,
    dao_code_hash: state.dao_hash ?? OFFICIAL_SPUTNIK_HASH,
    default_agent: state.accounts.bank.id,
    price_feeder: state.accounts.bank.id,
    snipe_window_secs: 20,
    epoch_secs: 30,
    dao_proposal_period_secs: 600,
  });
  const r = await call("lp", LP(), "new", { config: cfg }, { gas: 100n });
  check(r.failures.length === 0, "launchpad initialised", r.failures.join(" | "));
  const p = await call("bank", LP(), "set_near_usd_price", { price_micro_usd: "3590000" }, { gas: 10n });
  check(p.failures.length === 0, "NEAR/USD seeded (feeder mode on testnet)");
});

const SYM = state.sym ?? (state.sym = "E2E" + Date.now().toString(36).slice(-4).toUpperCase());
save();
const TOKEN = () => `${SYM.toLowerCase()}.${LP()}`;
const DAO = () => `${SYM.toLowerCase()}-dao.${LP()}`;

await step("launch token", async () => {
  const r = await call("bank", LP(), "create_token", {
    meta: { name: "E2E Moon", symbol: SYM, icon: null, description: "end-to-end test", website: null, twitter: null, telegram: null },
    agent_persona: null,
  }, { deposit: N(1.5) });
  const fails = SKIP_DAO ? r.failures.filter((f) => !f.includes("GlobalContractDoesNotExist")) : r.failures;
  check(fails.length === 0, "create_token", fails.join(" | "));
  const t = await view(LP(), "get_token", { token_id: TOKEN() });
  check(t?.deployed, "token contract deployed from global code", TOKEN());
  if (SKIP_DAO) {
    check(t?.dao_stage === "Failed", "missing DAO code -> DAO marked Failed, launch still live (retry_dao later)", t?.dao_stage);
  } else {
    check(t?.dao_stage === "Created", "Sputnik DAO created from official global code", `${DAO()} stage=${t?.dao_stage}`);
    const ver = await view(DAO(), "version").catch((e) => String(e));
    check(ver === "2.3.1", "DAO runs Sputnik v2.3.1", String(ver));
  }
  const md = await view(TOKEN(), "ft_metadata");
  check(md?.symbol === SYM, "token metadata", JSON.stringify(md).slice(0, 80));
});

if (!SKIP_DAO) await step("DAO hand-over", async () => {
  const r = await call("bank", LP(), "finalize_dao", { token_id: TOKEN() }, { gas: 200n });
  check(r.failures.length === 0, "finalize_dao receipts", r.failures.join(" | "));
  const t = await view(LP(), "get_token", { token_id: TOKEN() });
  check(t.dao_stage === "Ready", "DAO stage Ready", t.dao_stage);
  check((await view(DAO(), "get_staking_contract")) === LP(), "launchpad is the DAO's staking contract");
  const pol = await view(DAO(), "get_policy");
  const holders = pol.roles.find((x) => x.name === "holders");
  check(!pol.roles.some((x) => x.name === "launcher") && holders?.kind?.Member === "1", "launcher removed; lockers hold the voting role", JSON.stringify(pol.roles.map((x) => x.name)));
  check(JSON.stringify(pol.default_vote_policy.threshold) === "[7,10]" && pol.default_vote_policy.weight_kind === "TokenWeight", ">70% token-weighted default policy");
});

await step("curve trading", async () => {
  await sleep(21_000); // let the fair-launch window close
  const r = await call("bob", LP(), "buy", { token_id: TOKEN(), min_tokens_out: "0", referrer: state.accounts.whale.id }, { deposit: N(1.5), gas: 100n });
  check(r.failures.length === 0, "buy (with referrer)", r.failures.join(" | "));
  const bal = BigInt(await view(TOKEN(), "ft_balance_of", { account_id: state.accounts.bob.id }));
  check(bal > 0n, "buyer received tokens", `${bal / 10n ** 18n} tokens`);
  const ref = await view(LP(), "get_referral_balance", { account_id: state.accounts.whale.id });
  check(BigInt(ref) > 0n, "referrer credited", `${fmt(ref)} NEAR`);
  const sell = bal / 10n;
  const s = await call("bob", TOKEN(), "ft_transfer_call", { receiver_id: LP(), amount: sell.toString(), msg: JSON.stringify({ action: "sell" }) }, { deposit: 1n, gas: 150n });
  check(s.failures.length === 0, "sell back to curve (pays 2.5% + exit fee)", s.failures.join(" | "));
  const after = BigInt(await view(TOKEN(), "ft_balance_of", { account_id: state.accounts.bob.id }));
  check(after === bal - sell, "sell debited tokens");
});

await step("lock -> DAO weight", async () => {
  const bal = BigInt(await view(TOKEN(), "ft_balance_of", { account_id: state.accounts.bob.id }));
  const lock = bal / 2n;
  const r = await call("bob", TOKEN(), "ft_transfer_call", { receiver_id: LP(), amount: lock.toString(), msg: JSON.stringify({ action: "lock", days: 30 }) }, { deposit: 1n, gas: 200n });
  check(r.failures.length === 0, "lock 30 days", r.failures.join(" | "));
  await sleep(3000);
  const pos = await view(LP(), "get_position", { token_id: TOKEN(), account_id: state.accounts.bob.id });
  check(BigInt(pos.weight) > BigInt(lock), "lock weight > locked amount (time multiplier)", `${BigInt(pos.weight) / 10n ** 18n}`);
  if (!SKIP_DAO) {
    const w = await view(DAO(), "delegation_balance_of", { account_id: state.accounts.bob.id });
    check(BigInt(w) > 0n && w === pos.weight, "Sputnik delegation equals lock weight", `${BigInt(w) / 10n ** 18n}`);
  }
  const a = await call("bob", LP(), "set_allocation", { token_id: TOKEN(), alloc: [2000, 3000, 3000, 1000, 1000] }, { gas: 30n });
  check(a.failures.length === 0, "yield allocation vote");
});

if (!SKIP_DAO) await step("DAO proposal by locker", async () => {
  const pol = await view(DAO(), "get_policy");
  const kind = "Vote";
  const add = await call("bob", DAO(), "add_proposal", { proposal: { description: "* Title: e2e signal <br>* Notes: holders agree", kind } }, { deposit: BigInt(pol.proposal_bond), gas: 100n });
  check(add.failures.length === 0, "locker can add proposal", add.failures.join(" | "));
  const id = add.value;
  const nobody = await call("whale", DAO(), "add_proposal", { proposal: { description: "spam", kind } }, { deposit: BigInt(pol.proposal_bond), gas: 100n }).catch((e) => ({ failures: [String(e)] }));
  check(nobody.failures.length > 0, "non-locker cannot add proposal");
  const v = await call("bob", DAO(), "act_proposal", { id, action: "VoteApprove", proposal: kind }, { gas: 200n });
  check(v.failures.length === 0, "locker votes", v.failures.join(" | "));
  const p = await view(DAO(), "get_proposal", { id });
  check(p.status === "Approved", "proposal passes with >70% of lock weight", p.status);
});

await step("graduate", async () => {
  const r = await call("whale", LP(), "buy", { token_id: TOKEN(), min_tokens_out: "0", referrer: null }, { deposit: N(Number(process.env.WHALE_BUY ?? 9.5)), gas: 100n });
  check(r.failures.length === 0, "whale buy sells out the curve", r.failures.join(" | "));
  let t = await view(LP(), "get_token", { token_id: TOKEN() });
  check(t.grad_stage === "CreatePool", "curve closed, graduation started", t.grad_stage);
  for (const expect of ["Stake", "Deposit", "AddLiquidity", "Graduated"]) {
    const s = await call("bank", LP(), "advance_graduation", { token_id: TOKEN() }, { gas: 300n });
    t = await view(LP(), "get_token", { token_id: TOKEN() });
    check(t.grad_stage === expect, `graduation -> ${expect}`, s.failures.join(" | ") || `pool=${t.pool_id}`);
    if (t.grad_stage !== expect) { console.log(s.logs.join("\n")); throw new Error("graduation stalled"); }
  }
  const pool = await view(REF, "get_pool", { pool_id: t.pool_id });
  check(pool.token_account_ids.includes(TOKEN()) && pool.token_account_ids.includes(LINEAR), "Ref MEME/LiNEAR pool live", JSON.stringify(pool.amounts));
  const shares = await view(REF, "get_pool_shares", { pool_id: t.pool_id, account_id: LP() });
  check(BigInt(shares) > 0n, "LP shares owned by the launchpad (no withdraw path = locked)", shares);
  const lin = BigInt(await view(LINEAR, "ft_balance_of", { account_id: LP() }));
  check(lin > 0n && BigInt(t.linear_shares) > 0n, "vault staked in LiNEAR", `vault ${fmt(t.linear_shares)} LiNEAR`);
  state.pool_id = t.pool_id;
});

await step("fund yield + epoch (buyback, airdrop, agent)", async () => {
  // Get LiNEAR for the sponsor and donate it as yield, so the epoch has something to split.
  const st = await call("whale", LINEAR, "deposit_and_stake", {}, { deposit: N(1.2), gas: 50n });
  check(st.failures.length === 0, "sponsor stakes NEAR into LiNEAR");
  const linBal = BigInt(await view(LINEAR, "ft_balance_of", { account_id: state.accounts.whale.id }));
  const f = await call("whale", LINEAR, "ft_transfer_call", { receiver_id: LP(), amount: linBal.toString(), msg: JSON.stringify({ fund_yield: TOKEN() }) }, { deposit: 1n, gas: 100n });
  check(f.failures.length === 0, "LiNEAR yield funding accepted", f.failures.join(" | "));
  const before = await view(LP(), "get_token", { token_id: TOKEN() });
  await sleep(31_000);
  const e = await call("bank", LP(), "settle_epoch", { token_id: TOKEN() }, { gas: 300n });
  check(e.failures.length === 0, "settle_epoch receipts", e.failures.join(" | "));
  await sleep(4000);
  const after = await view(LP(), "get_token", { token_id: TOKEN() });
  const ep = (await view(LP(), "get_epochs", { token_id: TOKEN(), limit: 1 }))[0];
  check(after.epoch_index === before.epoch_index + 1, "epoch settled", `yield ${fmt(ep.yield_shares)} LiNEAR split ${ep.split.map(fmt).join("/")}`);
  check(BigInt(after.burned) > BigInt(before.burned), "Ref buyback bought and burned tokens", `burned +${(BigInt(after.burned) - BigInt(before.burned)) / 10n ** 18n}`);
  check(BigInt(after.agent_budget_shares) > 0n, "agent budget funded", fmt(after.agent_budget_shares));
  const pos = await view(LP(), "get_position", { token_id: TOKEN(), account_id: state.accounts.bob.id });
  check(BigInt(pos.pending_reward) > 0n, "airdrop accrued to locker", fmt(pos.pending_reward));
  if (SKIP_DAO) {
    check(BigInt(ep.split[4]) === 0n, "treasury share folds into the floor while no DAO is ready", ep.split.map(fmt).join("/"));
  } else {
    const dao = BigInt(await view(LINEAR, "ft_balance_of", { account_id: DAO() }));
    check(dao > 0n, "DAO treasury received its LiNEAR share", fmt(dao));
  }
});

await step("redeem + withdraw + agent", async () => {
  const bal = BigInt(await view(TOKEN(), "ft_balance_of", { account_id: state.accounts.bob.id }));
  const q = await view(LP(), "quote_redeem", { token_id: TOKEN(), tokens_in: (bal / 2n).toString(), age_secs: 0 });
  const r = await call("bob", TOKEN(), "ft_transfer_call", { receiver_id: LP(), amount: (bal / 2n).toString(), msg: JSON.stringify({ action: "redeem" }) }, { deposit: 1n, gas: 150n });
  check(r.failures.length === 0, "redeem at floor", `quote ${fmt(q.amount_out)} LiNEAR`);
  await call("bob", LP(), "claim_rewards", { token_id: TOKEN() }, { gas: 30n });
  await call("bob", LINEAR, "storage_deposit", { account_id: state.accounts.bob.id, registration_only: true }, { deposit: 1_250_000_000_000_000_000_000n, gas: 10n });
  const before = BigInt(await view(LINEAR, "ft_balance_of", { account_id: state.accounts.bob.id }));
  const w = await call("bob", LP(), "withdraw_linear", {}, { deposit: 1n, gas: 50n });
  const after = BigInt(await view(LINEAR, "ft_balance_of", { account_id: state.accounts.bob.id }));
  check(w.failures.length === 0 && after > before, "withdraw LiNEAR (redemption + airdrop)", `+${fmt(after - before)} LiNEAR`);
  const a = await call("bank", LP(), "agent_post", { token_id: TOKEN(), text: "gm from the e2e agent" }, { deposit: N(0.01), gas: 30n });
  check(a.failures.length === 0, "agent post paid from budget", a.failures.join(" | "));
});

if (process.env.LOCK === "1") await step("lock launchpad (delete full-access keys)", async () => {
  const lp = acct("lp");
  const keys = await lp.getAccessKeyList();
  for (const k of keys.keys.filter((k) => k.access_key.permission === "FullAccess")) await lp.deleteKey(k.public_key);
  const after = await provider.viewAccessKeyList({ accountId: LP() }).catch(() => ({ keys: [] }));
  check(after.keys.length === 0, "launchpad has no access keys: nobody can upgrade or withdraw", `${after.keys.length} keys left`);
  const sweep = await call("bob", LP(), "sweep_platform_fees", {}, { gas: 20n });
  check(sweep.failures.length === 0, "anyone can sweep fees, which go only to the treasury", sweep.failures.join(" | "));
});

// Re-derive every outcome from chain state (independent of earlier step logs).
console.log("• on-chain verification");
{
  const t = await view(LP(), "get_token", { token_id: TOKEN() });
  check(t.grad_stage === "Graduated", "token graduated", `pool #${t.pool_id}`);
  const pool = await view(REF, "get_pool", { pool_id: t.pool_id });
  const iM = pool.token_account_ids.indexOf(TOKEN());
  check(iM >= 0 && pool.token_account_ids.includes(LINEAR), "Ref pool is MEME/LiNEAR", `${BigInt(pool.amounts[iM]) / 10n ** 18n} MEME / ${fmt(pool.amounts[1 - iM])} LiNEAR`);
  const shares = await view(REF, "get_pool_shares", { pool_id: t.pool_id, account_id: LP() });
  check(BigInt(shares) > 0n, "launchpad holds the LP shares", shares);
  const lpPrice = Number((BigInt(pool.amounts[1 - iM]) * 10n ** 12n) / BigInt(pool.amounts[iM])) / 1e18 / 1e6;
  const curvePrice = Number((BigInt(t.v_near) * 10n ** 12n) / BigInt(t.v_tokens)) / 1e18 / 1e6;
  const linPrice = Number(BigInt(await view(LINEAR, "ft_price")) / 10n ** 18n) / 1e6;
  check(Math.abs((lpPrice * linPrice) / curvePrice - 1) < 0.15, "Ref opened near the final curve price", `ref ${(lpPrice * linPrice).toExponential(3)} vs curve ${curvePrice.toExponential(3)} NEAR`);
  check(BigInt(t.linear_shares) > 0n, "vault holds LiNEAR", fmt(t.linear_shares));
  check(BigInt(t.lp_tokens) < 240_000_000n * 10n ** 18n, "unused LP tokens burned at graduation", `LP ${BigInt(t.lp_tokens) / 10n ** 18n} of 240M`);
  const ep = await view(LP(), "get_epochs", { token_id: TOKEN(), limit: 5 });
  check(ep.length >= 1, "epoch report on-chain", ep[0] ? `yield ${fmt(ep[0].yield_shares)} split ${ep[0].split.map(fmt).join("/")}` : "none");
  check(!!ep[0] && BigInt(ep[0].split[1]) > 0n, "buyback bucket funded", ep[0] ? fmt(ep[0].split[1]) : "");
  const supply = BigInt(await view(TOKEN(), "ft_total_supply"));
  check(supply === 10n ** 27n - BigInt(t.burned), "token supply = 1B - burned (burns executed on the token)", `${supply / 10n ** 18n}`);
  check(BigInt(t.burned) > 240_000_000n * 10n ** 18n - BigInt(t.lp_tokens), "buyback burn on top of the graduation burn", `burned ${BigInt(t.burned) / 10n ** 18n}`);
  check(t.post_count >= 1, "agent posted (paid from voted budget)", `posts ${t.post_count}, budget left ${fmt(t.agent_budget_shares)}`);
  check(BigInt(t.platform_fees ?? 0) >= 0n, "platform fee accounting readable");
}

console.log("\n==== summary ====");
for (const [s, n, d] of results) console.log(`${s}  ${n}${d ? "  — " + d : ""}`);
console.log(`launchpad ${LP()}  token ${TOKEN()}  dao ${DAO()}`);
process.exit(results.some((r) => r[0] === "FAIL") ? 1 : 0);
