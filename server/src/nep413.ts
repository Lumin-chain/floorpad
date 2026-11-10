// NEP-413 (signMessage) verification: https://github.com/near/NEPs/blob/master/neps/nep-0413.md
import { createHash, createPublicKey, verify } from "node:crypto";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Decode(s: string): Uint8Array {
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error("bad base58");
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n % 256n));
    n /= 256n;
  }
  for (const c of s) {
    if (c !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};
const borshString = (s: string) => {
  const b = Buffer.from(s, "utf8");
  return Buffer.concat([u32(b.length), b]);
};

/** sha256(borsh(tag) ++ borsh(Payload)) – the bytes a NEP-413 wallet signs. */
export function nep413Hash(message: string, nonce: Uint8Array, recipient: string, callbackUrl?: string | null): Buffer {
  if (nonce.length !== 32) throw new Error("nonce must be 32 bytes");
  const tag = u32(2 ** 31 + 413);
  const cb = callbackUrl ? Buffer.concat([Buffer.from([1]), borshString(callbackUrl)]) : Buffer.from([0]);
  const payload = Buffer.concat([borshString(message), Buffer.from(nonce), borshString(recipient), cb]);
  return createHash("sha256").update(Buffer.concat([tag, payload])).digest();
}

export function ed25519Verify(publicKey: string, data: Buffer, signature: Uint8Array): boolean {
  if (!publicKey.startsWith("ed25519:")) return false;
  const raw = base58Decode(publicKey.slice(8));
  if (raw.length !== 32) return false;
  const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(raw).toString("base64url") }, format: "jwk" });
  return verify(null, data, key, signature);
}

/** Verifies the signature against the payload (with and without the callbackUrl, as wallets differ). */
export function verifySignedMessage(p: {
  publicKey: string;
  signature: string; // base64
  message: string;
  nonce: Uint8Array;
  recipient: string;
  callbackUrl?: string | null;
}): boolean {
  const sig = Buffer.from(p.signature, "base64");
  if (sig.length !== 64) return false;
  const variants = p.callbackUrl ? [p.callbackUrl, null] : [null];
  return variants.some((cb) => ed25519Verify(p.publicKey, nep413Hash(p.message, p.nonce, p.recipient, cb), sig));
}
