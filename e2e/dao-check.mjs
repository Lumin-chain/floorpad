/**
 * On-chain check of the DAO side against the official Sputnik DAO v2.3.1 code
 * (deployed as a normal contract here, so it costs ~4.4 NEAR instead of the ~44 NEAR
 * global deploy). The "bank" account plays the launchpad: it creates the DAO with
 * the launcher policy, performs the same two-proposal hand-over, then acts as the
 * DAO's staking contract (register_delegation / delegate / undelegate).
 *
 * Verifies: hand-over, lockers-only proposals, strict ">70%" pass rule,
 * non-holder bounty completion, payout, undelegation.
 *
 *   SPUTNIK_WASM=... node dao-check.mjs   (uses accounts from .state.json)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Account, JsonRpcProvider, KeyPair } from "near-api-js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const state = JSON.parse(fs.readFileSync(path.join(HERE, ".state.json"), "utf8"));
const { holders_policy } = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/holders_policy.json"), "utf8"));
const provider = new JsonRpcProvider({ url: process.env.NEAR_RPC ?? "https://rpc.testnet.fastnear.com" });
const NEAR = 10n ** 24n, TGAS = 10n ** 12n, NS = 1_000_000_000n;
const acct = (l) => new Account(state.accounts[l].id, provider, state.accounts[l].key);
const id = (l) => state.accounts[l].id;
const view = (c, m, a = {}) => provider.callFunction({ contractId: c, method: m, args: a });
const results = [];
const check = (c, n, d = "") => { results.push([c ? "PASS" : "FAIL", n, d]); console.log(`  ${c ? "✓" : "✗"} ${n} ${d}`); };

async function call(l, contractId, methodName, args = {}, deposit = 0n, gas = 150n) {
  const res = await acct(l).callFunctionRaw({ contractId, methodName, args, deposit, gas: gas * TGAS, waitUntil: "EXECUTED_OPTIMISTIC" }).catch((e) => ({ error: String(e).slice(0, 300) }));
  if (res.error) return { failures: [res.error], value: null };
  const failures = [];
  for (const r of [res.transaction_outcome, ...res.receipts_outcome]) if (r.outcome.status?.Failure) failures.push(JSON.stringify(r.outcome.status.Failure).slice(0, 300));
  let value = null;
  if (res.status?.SuccessValue !== undefined) {
    const s = Buffer.from(res.status.SuccessValue, "base64").toString();
    try { value = s ? JSON.parse(s) : null; } catch { value = s; }
  }
  return { failures, value };
}

const bank = id("bank");
const daoId = `daochk${Date.now().toString(36)}.${bank}`;
const carolL = Object.keys(state.accounts).find((k) => /^f\d+$/.test(k));
console.log(`DAO ${daoId} (launchpad role: ${bank}, lockers: bob 70% / ${carolL} 30%, hunter: whale)`);

// 1. create the DAO exactly as the launchpad does (launcher policy), using v2.3.1 code
const code = fs.readFileSync(process.env.SPUTNIK_WASM);
const kp = KeyPair.fromRandom("ed25519");
await acct("bank").createSubAccount({ accountOrPrefix: daoId, publicKey: kp.getPublicKey().toString(), nearToTransfer: 5n * NEAR + NEAR / 2n });
await new Account(daoId, provider, kp.toString()).deployContract(code);
const launcher = {
  roles: [{ name: "launcher", kind: { Group: [bank] }, permissions: ["*:*"], vote_policy: {} }],
  default_vote_policy: { weight_kind: "RoleWeight", quorum: "0", threshold: [1, 1] },
  proposal_bond: "0", proposal_period: (600n * NS).toString(), bounty_bond: "0", bounty_forgiveness_period: (86400n * NS).toString(),
};
const init = await call("bank", daoId, "new", { config: { name: "daochk", purpose: "floorpad e2e", metadata: "" }, policy: launcher }, 0n, 100n);
check(init.failures.length === 0, "DAO init with launcher policy (v2.3.1)", init.failures.join(" | "));
check((await view(daoId, "version")) === "2.3.1", "DAO code is Sputnik v2.3.1");

// 2. hand-over: same two proposals finalize_dao sends
const policy = { ...holders_policy, proposal_period: (600n * NS).toString() };
const k1 = { SetStakingContract: { staking_id: bank } };
const k2 = { ChangePolicy: { policy } };
for (const [kind, label] of [[k1, "set staking contract"], [k2, "switch to holders policy"]]) {
  const add = await call("bank", daoId, "add_proposal", { proposal: { description: `* Title: ${label}`, kind } });
  const act = await call("bank", daoId, "act_proposal", { id: add.value, action: "VoteApprove", proposal: kind, memo: null }, 0n, 200n);
  check(add.failures.length + act.failures.length === 0, `hand-over: ${label}`, [...add.failures, ...act.failures].join(" | "));
}
check((await view(daoId, "get_staking_contract")) === bank, "staking contract = launchpad");
const pol = await view(daoId, "get_policy");
check(!pol.roles.some((r) => r.name === "launcher"), "launcher has no role after hand-over", pol.roles.map((r) => r.name).join(","));

// 3. the launchpad (staking contract) delegates lock weight: bob 70, carol 30
const reg = 16n * 10n ** 19n;
for (const [l, w] of [["bob", 70n], [carolL, 30n]]) {
  const r = await call("bank", daoId, "register_delegation", { account_id: id(l) }, reg, 30n);
  const d = await call("bank", daoId, "delegate", { account_id: id(l), amount: (w * NEAR).toString() }, 0n, 30n);
  check(r.failures.length + d.failures.length === 0, `delegate ${w} weight to ${l}`, [...r.failures, ...d.failures].join(" | "));
}
check(BigInt(await view(daoId, "delegation_total_supply")) === 100n * NEAR, "total delegated = 100");
await acct("bank").transfer({ receiverId: id(carolL), amount: NEAR / 2n });

// 4. lockers-only proposals; strict >70%
const bond = BigInt(pol.proposal_bond);
const spam = await call("whale", daoId, "add_proposal", { proposal: { description: "spam", kind: "Vote" } }, bond);
check(spam.failures.length > 0, "non-locker cannot create a governance proposal");
const p = await call("bob", daoId, "add_proposal", { proposal: { description: "* Title: signal <br>* Notes: test", kind: "Vote" } }, bond);
check(p.failures.length === 0, "locker creates proposal", p.failures.join(" | "));
await call("bob", daoId, "act_proposal", { id: p.value, action: "VoteApprove", proposal: "Vote", memo: null });
check((await view(daoId, "get_proposal", { id: p.value })).status === "InProgress", "exactly 70% yes does NOT pass (needs >70%)");
await call(carolL, daoId, "act_proposal", { id: p.value, action: "VoteApprove", proposal: "Vote", memo: null });
check((await view(daoId, "get_proposal", { id: p.value })).status === "Approved", "100% yes passes");

// 5. bounty: holders fund it, a non-holder claims and delivers, holders pay
const bounty = { AddBounty: { bounty: { description: "meme video", token: "", amount: (NEAR / 10n).toString(), times: 1, max_deadline: (86400n * NS).toString() } } };
const b = await call("bob", daoId, "add_proposal", { proposal: { description: "* Title: video bounty", kind: bounty } }, bond);
await call("bob", daoId, "act_proposal", { id: b.value, action: "VoteApprove", proposal: bounty, memo: null }, 0n, 200n);
await call(carolL, daoId, "act_proposal", { id: b.value, action: "VoteApprove", proposal: bounty, memo: null }, 0n, 200n);
const bounties = await view(daoId, "get_bounties", { from_index: 0, limit: 10 });
check(bounties.length === 1, "bounty created by holder vote");
const claim = await call("whale", daoId, "bounty_claim", { id: bounties[0].id, deadline: (3600n * NS).toString() }, BigInt(pol.bounty_bond), 50n);
check(claim.failures.length === 0, "non-holder claims bounty", claim.failures.join(" | "));
const done = await call("whale", daoId, "bounty_done", { id: bounties[0].id, account_id: null, description: "* Title: delivered <br>* Notes: https://example.com/video" }, bond, 100n);
check(done.failures.length === 0, "non-holder submits finished work (bounty-hunters role)", done.failures.join(" | "));
const last = (await view(daoId, "get_last_proposal_id")) - 1;
const kindDone = (await view(daoId, "get_proposal", { id: last })).kind;
const before = BigInt((await provider.viewAccount({ accountId: id("whale") })).amount);
await call("bob", daoId, "act_proposal", { id: last, action: "VoteApprove", proposal: kindDone, memo: null }, 0n, 200n);
await call(carolL, daoId, "act_proposal", { id: last, action: "VoteApprove", proposal: kindDone, memo: null }, 0n, 200n);
const after = BigInt((await provider.viewAccount({ accountId: id("whale") })).amount);
check((await view(daoId, "get_proposal", { id: last })).status === "Approved" && after > before, "holders approve; bounty paid to hunter", `+${Number((after - before) / 10n ** 21n) / 1000} NEAR`);

// 6. unlock -> undelegate
const u = await call("bank", daoId, "undelegate", { account_id: id("bob"), amount: (70n * NEAR).toString() }, 0n, 30n);
check(u.failures.length === 0 && BigInt(await view(daoId, "delegation_balance_of", { account_id: id("bob") })) === 0n, "undelegate on unlock");

console.log("\n==== DAO summary ====");
for (const [s, n, d] of results) console.log(`${s}  ${n}${d ? "  — " + d : ""}`);
process.exit(results.some((r) => r[0] === "FAIL") ? 1 : 0);
