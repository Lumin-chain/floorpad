import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { KeyPair, Account, JsonRpcProvider } = require("../e2e/node_modules/near-api-js");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RPC = process.env.NEAR_RPC ?? "https://rpc.testnet.fastnear.com";
const HELPER = "https://helper.testnet.near.org";
const TARGET_ID = "fpqa-351313.testnet";
const CRED_PATH = path.join(os.homedir(), ".near-credentials", "testnet", `${TARGET_ID}.json`);
const WASM_PATH = path.join(HERE, "sputnikdao2_v2.3.1.wasm");
const EXPECTED_HASH = "DtHZA1mUmGYeScEaUoUZYQGGFHSMpnjMCvkr5U9hJXuF";

const provider = new JsonRpcProvider({ url: RPC });
const NEAR = 10n ** 24n;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const b58 = (buf) => {
  const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = BigInt("0x" + Buffer.from(buf).toString("hex")), s = "";
  while (n > 0n) { s = A[Number(n % 58n)] + s; n /= 58n; }
  return s;
};

async function getBalance(id) {
  try {
    const st = await provider.viewAccount({ accountId: id });
    return BigInt(st.amount);
  } catch (e) {
    return 0n;
  }
}

async function fundTargetTo(targetNear) {
  let bal = await getBalance(TARGET_ID);
  console.log(`Current ${TARGET_ID} balance: ${(Number(bal / (10n ** 21n)) / 1000).toFixed(2)} NEAR`);
  const targetBig = BigInt(targetNear) * NEAR;
  
  while (bal < targetBig) {
    const kp = KeyPair.fromRandom("ed25519");
    const id = `fpfaucet${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(-3)}.testnet`;
    console.log(`Creating faucet account ${id}...`);
    const r = await fetch(`${HELPER}/account`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newAccountId: id, newAccountPublicKey: kp.getPublicKey().toString() })
    });
    if (!r.ok) {
      console.warn(`Faucet returned ${r.status}: ${await r.text()}`);
      await sleep(3000);
      continue;
    }
    
    // Wait for account to appear on RPC
    for (let i = 0; i < 15; i++) {
      await sleep(1500);
      const b = await getBalance(id);
      if (b > 0n) {
        console.log(`  funded ${id} with ${(Number(b / (10n ** 21n)) / 1000).toFixed(2)} NEAR -> sweeping to ${TARGET_ID}...`);
        const acct = new Account(id, provider, kp.toString());
        const sweepAmt = b - (10n ** 22n) * 5n; // reserve 0.05 NEAR for gas
        await acct.transfer({ receiverId: TARGET_ID, amount: sweepAmt });
        break;
      }
    }
    
    await sleep(2000);
    bal = await getBalance(TARGET_ID);
    console.log(`Updated ${TARGET_ID} balance: ${(Number(bal / (10n ** 21n)) / 1000).toFixed(2)} NEAR`);
  }
}

async function main() {
  console.log(`=== Sputnik DAO v2.3.1 Global Deployment to NEAR Testnet ===`);
  const wasm = fs.readFileSync(WASM_PATH);
  const hash = b58(createHash("sha256").update(wasm).digest());
  console.log(`Wasm size: ${wasm.length} bytes`);
  console.log(`Computed hash: ${hash}`);
  if (hash !== EXPECTED_HASH) {
    throw new Error(`Hash mismatch! Expected ${EXPECTED_HASH}, got ${hash}`);
  }

  // Check if already deployed
  const check = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "1",
      method: "query",
      params: { request_type: "view_global_contract_code", finality: "final", code_hash: hash }
    })
  }).then(r => r.json());

  if (check.result && !check.error) {
    console.log(`✓ Sputnik DAO code ${hash} is ALREADY globally deployed on testnet!`);
    return;
  }

  // Ensure target account has at least 48 NEAR
  await fundTargetTo(48);

  // Load target account key
  const creds = JSON.parse(fs.readFileSync(CRED_PATH, "utf8"));
  const privKey = creds.private_key || creds.secret_key;
  const targetAcct = new Account(TARGET_ID, provider, privKey);

  console.log(`Deploying global contract code (${wasm.length} bytes) via ${TARGET_ID}...`);
  const res = await targetAcct.deployGlobalContract(wasm, "codeHash");
  console.log(`Transaction submitted! Outcome:`, res.transaction?.hash ?? "Done");

  await sleep(3000);

  // Verify
  const verify = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "verify",
      method: "query",
      params: { request_type: "view_global_contract_code", finality: "final", code_hash: hash }
    })
  }).then(r => r.json());

  if (verify.result && !verify.error) {
    console.log(`\n🎉 SUCCESS! Sputnik DAO v2.3.1 is now globally available on NEAR testnet under hash ${hash}!`);
  } else {
    console.error(`Verification error:`, verify);
  }
}

main().catch(console.error);
