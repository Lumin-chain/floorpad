import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { base58Decode, nep413Hash, verifySignedMessage } from "./nep413.ts";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Encode(bytes: Uint8Array): string {
  let n = BigInt("0x" + (Buffer.from(bytes).toString("hex") || "0"));
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url");
  return { pk: "ed25519:" + base58Encode(raw), privateKey };
}

test("base58 round trip", () => {
  const b = randomBytes(32);
  assert.deepEqual(Buffer.from(base58Decode(base58Encode(b))), b);
});

test("verifies a NEP-413 signature", () => {
  const { pk, privateKey } = keypair();
  const nonce = randomBytes(32);
  const msg = { message: "Sign in to Floorpad", nonce, recipient: "floorpad" };
  const signature = sign(null, nep413Hash(msg.message, nonce, msg.recipient, null), privateKey).toString("base64");
  assert.equal(verifySignedMessage({ ...msg, publicKey: pk, signature }), true);
});

test("accepts wallets that include the callbackUrl in the payload", () => {
  const { pk, privateKey } = keypair();
  const nonce = randomBytes(32);
  const cb = "https://floorpad.app/token/x";
  const signature = sign(null, nep413Hash("hi", nonce, "floorpad", cb), privateKey).toString("base64");
  assert.equal(verifySignedMessage({ message: "hi", nonce, recipient: "floorpad", callbackUrl: cb, publicKey: pk, signature }), true);
});

test("rejects tampered message, nonce or key", () => {
  const { pk, privateKey } = keypair();
  const other = keypair();
  const nonce = randomBytes(32);
  const signature = sign(null, nep413Hash("hi", nonce, "floorpad", null), privateKey).toString("base64");
  assert.equal(verifySignedMessage({ message: "hi!", nonce, recipient: "floorpad", publicKey: pk, signature }), false);
  assert.equal(verifySignedMessage({ message: "hi", nonce: randomBytes(32), recipient: "floorpad", publicKey: pk, signature }), false);
  assert.equal(verifySignedMessage({ message: "hi", nonce, recipient: "floorpad", publicKey: other.pk, signature }), false);
});
