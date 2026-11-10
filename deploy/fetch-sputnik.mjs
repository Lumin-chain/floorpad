// Downloads the official Sputnik DAO v2.3.1 global contract code from NEAR mainnet by
// its code hash and verifies the bytes hash to it. Needed only to put the same code
// on testnet (mainnet launches reference the existing global code directly).
//   node deploy/fetch-sputnik.mjs out.wasm
import fs from "node:fs";
import { createHash } from "node:crypto";

const HASH = "DtHZA1mUmGYeScEaUoUZYQGGFHSMpnjMCvkr5U9hJXuF"; // Sputnik DAO v2.3.1 (sputnik-dao.near default code)
const out = process.argv[2] ?? "sputnikdao2_v2.3.1.wasm";
const r = await (await fetch("https://rpc.mainnet.fastnear.com", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_global_contract_code", finality: "final", code_hash: HASH } }),
})).json();
if (!r.result?.code_base64) throw new Error(`fetch failed: ${JSON.stringify(r).slice(0, 200)}`);
const buf = Buffer.from(r.result.code_base64, "base64");
const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
let n = BigInt("0x" + createHash("sha256").update(buf).digest("hex")), s = "";
while (n > 0n) { s = A[Number(n % 58n)] + s; n /= 58n; }
if (s !== HASH) throw new Error(`hash mismatch: ${s}`);
fs.writeFileSync(out, buf);
console.log(`${out}: ${buf.length} bytes, hash ${HASH} verified`);
