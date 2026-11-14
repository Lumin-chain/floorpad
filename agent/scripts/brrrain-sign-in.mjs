#!/usr/bin/env node
// Signs a NEAR account in to BRRRAIN (NEP-413, no transaction) and creates an
// API key. Node 20+, no dependencies.
//
//   NEAR_ACCOUNT_ID=alice.near NEAR_PRIVATE_KEY=ed25519:… node brrrain-sign-in.mjs
//
// Optional: KEY_NAME (default "agent"), DAILY_CAP_POWER (a cap for this key),
// BRRRAIN_API (default https://api.brrrain.fun). The private key is read from the environment
// only (a command line is visible to every process) and never leaves this
// machine; it must be a full-access key of the account. The new API key is
// printed once on stdout; everything else goes to stderr.

import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";

const NEP413_TAG = 2147484061;
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function b58decode(s) {
  let n = 0n;
  for (const c of s) {
    const i = ALPHABET.indexOf(c);
    if (i < 0) throw new Error("the key is not valid base58");
    n = n * 58n + BigInt(i);
  }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n % 256n)); n /= 256n; }
  for (const c of s) { if (c !== "1") break; bytes.unshift(0); }
  return Buffer.from(bytes);
}

function b58encode(buf) {
  let n = BigInt("0x" + (buf.toString("hex") || "0"));
  let out = "";
  while (n > 0n) { out = ALPHABET[Number(n % 58n)] + out; n /= 58n; }
  for (const b of buf) { if (b !== 0) break; out = "1" + out; }
  return out;
}

/** `ed25519:<base58>` of 64 bytes (seed + public key, near-cli's format) or a 32-byte seed. */
export function keyFromText(text) {
  if (!text.startsWith("ed25519:")) throw new Error("the private key must look like ed25519:<base58>");
  const raw = b58decode(text.slice(8));
  if (raw.length !== 64 && raw.length !== 32) throw new Error("an ed25519 private key has 64 bytes (or a 32-byte seed)");
  const seed = raw.subarray(0, 32);
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  const privateKey = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  const pub = Buffer.from(createPublicKey(privateKey).export({ format: "jwk" }).x, "base64url");
  if (raw.length === 64 && !raw.subarray(32).equals(pub)) throw new Error("the key's public half does not match its seed");
  return { privateKey, publicKey: "ed25519:" + b58encode(pub) };
}

function borshString(s) {
  const b = Buffer.from(s, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(b.length);
  return Buffer.concat([len, b]);
}

/** The NEP-413 signature (base64) of `message` for `recipient` with a 32-byte nonce. */
export function signNep413(privateKey, message, nonce, recipient) {
  const tag = Buffer.alloc(4);
  tag.writeUInt32LE(NEP413_TAG);
  const payload = Buffer.concat([tag, borshString(message), nonce, borshString(recipient), Buffer.from([0])]);
  const hash = createHash("sha256").update(payload).digest();
  return sign(null, hash, privateKey).toString("base64");
}

async function call(api, path, { method = "POST", body, token } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(api + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  const data = text ? JSON.parse(text) : {};
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${data.error?.code ?? ""}: ${data.error?.message ?? text}`);
  return data;
}

async function main() {
  const account = process.env.NEAR_ACCOUNT_ID;
  const secret = process.env.NEAR_PRIVATE_KEY;
  if (!account || !secret) throw new Error("set NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY (a full-access key of the account)");
  const api = (process.env.BRRRAIN_API || "https://api.brrrain.fun").replace(/\/$/, "");
  const { privateKey, publicKey } = keyFromText(secret.trim());

  const ch = await call(api, "/v1/auth/challenge", { body: { account_id: account } });
  const nonce = Buffer.from(ch.nonce, "base64");
  const signature = signNep413(privateKey, ch.message, nonce, ch.recipient);
  const session = await call(api, "/v1/auth/near", { body: { account_id: account, public_key: publicKey, signature, nonce: ch.nonce, session: "bearer" } });
  try {
    const cap = process.env.DAILY_CAP_POWER ? Number(process.env.DAILY_CAP_POWER) : undefined;
    const key = await call(api, "/v1/keys", { token: session.session_token, body: { name: process.env.KEY_NAME || "agent", daily_cap_power: cap } });
    console.error(`created API key "${key.name}" (${key.hint}…) for ${account}${key.daily_cap_power ? `, daily cap ${key.daily_cap_power} Power` : ""}; store it as a secret`);
    process.stdout.write(key.secret + "\n");
  } finally {
    await call(api, "/v1/auth/logout", { token: session.session_token }).catch(() => {});
  }
}

main().catch((e) => { console.error(`error: ${e.message}`); process.exit(1); });
