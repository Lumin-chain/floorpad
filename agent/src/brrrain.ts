import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";

const NEP413_TAG = 2147484061;
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function b58decode(s: string): Buffer {
  let n = 0n;
  for (const c of s) {
    const i = ALPHABET.indexOf(c);
    if (i < 0) throw new Error("the key is not valid base58");
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
  return Buffer.from(bytes);
}

function b58encode(buf: Buffer): string {
  let n = BigInt("0x" + (buf.toString("hex") || "0"));
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of buf) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

export function keyFromText(text: string) {
  if (!text.startsWith("ed25519:")) throw new Error("the private key must look like ed25519:<base58>");
  const raw = b58decode(text.slice(8));
  if (raw.length !== 64 && raw.length !== 32) throw new Error("an ed25519 private key has 64 bytes (or a 32-byte seed)");
  const seed = raw.subarray(0, 32);
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  const privateKey = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  const pub = Buffer.from((createPublicKey(privateKey).export({ format: "jwk" }) as { x: string }).x, "base64url");
  if (raw.length === 64 && !raw.subarray(32).equals(pub)) throw new Error("the key's public half does not match its seed");
  return { privateKey, publicKey: "ed25519:" + b58encode(pub) };
}

function borshString(s: string): Buffer {
  const b = Buffer.from(s, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(b.length);
  return Buffer.concat([len, b]);
}

export function signNep413(privateKey: unknown, message: string, nonce: Buffer, recipient: string): string {
  const tag = Buffer.alloc(4);
  tag.writeUInt32LE(NEP413_TAG);
  const payload = Buffer.concat([tag, borshString(message), nonce, borshString(recipient), Buffer.from([0])]);
  const hash = createHash("sha256").update(payload).digest();
  return sign(null, hash, privateKey as Parameters<typeof sign>[2]).toString("base64");
}

let latestPower: number | null = null;

export function getLatestPowerRemaining(): number | null {
  return latestPower;
}

export function setLatestPowerRemaining(val: string | number | null) {
  if (val === null || val === undefined) return;
  const num = typeof val === "number" ? val : parseFloat(String(val));
  if (!Number.isNaN(num)) {
    latestPower = num;
  }
}

/**
 * Programmatically signs in via NEP-413 to BRRRAIN to get an API key with daily power.
 */
export async function obtainBrrrainKey(
  accountId: string,
  privateKeyText: string,
  apiBase: string = "https://api.brrrain.fun"
): Promise<string | null> {
  try {
    const api = apiBase.replace(/\/+$/, "");
    const { privateKey, publicKey } = keyFromText(privateKeyText.trim());

    // 1. Challenge
    const chRes = await fetch(`${api}/v1/auth/challenge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ account_id: accountId }),
    });
    if (!chRes.ok) throw new Error(`challenge failed ${chRes.status}`);
    const ch = (await chRes.json()) as { nonce: string; message: string; recipient: string };

    // 2. Sign
    const nonce = Buffer.from(ch.nonce, "base64");
    const signature = signNep413(privateKey, ch.message, nonce, ch.recipient);

    // 3. Auth
    const authRes = await fetch(`${api}/v1/auth/near`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        account_id: accountId,
        public_key: publicKey,
        signature,
        nonce: ch.nonce,
        session: "bearer",
      }),
    });
    if (!authRes.ok) throw new Error(`auth failed ${authRes.status}`);
    const session = (await authRes.json()) as { session_token: string };

    // 4. Create key
    const keyRes = await fetch(`${api}/v1/keys`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.session_token}`,
      },
      body: JSON.stringify({ name: `floorpad-keeper-${Date.now()}` }),
    });
    if (!keyRes.ok) throw new Error(`key creation failed ${keyRes.status}`);
    const keyData = (await keyRes.json()) as { secret: string };

    // Logout session
    await fetch(`${api}/v1/auth/logout`, {
      method: "POST",
      headers: { authorization: `Bearer ${session.session_token}` },
    }).catch(() => {});

    return keyData.secret;
  } catch (e) {
    console.warn(`[BRRRAIN Auto-Auth] Could not auto-acquire key:`, (e as Error).message);
    return null;
  }
}
