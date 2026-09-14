import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * API keys.
 *
 * Format:  latchk_<prefix>_<secret>
 *   prefix  12 base32 chars, random, stored in clear, unique. Shown in listings
 *           and logs so a key can be identified without revealing it.
 *   secret  43 base64url chars = 256 bits from the CSPRNG.
 *
 * Stored: HMAC-SHA256(pepper, full key). Never the key. With 256 bits of secret
 * a fast keyed hash is the right primitive (no brute-force surface to slow
 * down), and the pepper — kept out of the database — means a database dump
 * alone cannot be used to test candidate keys.
 *
 * The prefix deliberately avoids `latch_sk_`, the marker CLAUDE.md greps for as
 * a sign of a fake key in the UI.
 */

export const KEY_PREFIX = "latchk_";
const B32 = "abcdefghijklmnopqrstuvwxyz234567";
const KEY_RE = /^latchk_([a-z2-7]{12})_([A-Za-z0-9_-]{43})$/;

export const SCOPES = ["public:read", "dexscreener:read"] as const;
export type Scope = (typeof SCOPES)[number];

export function isScope(s: string): s is Scope {
  return (SCOPES as readonly string[]).includes(s);
}

function base32(bytes: Buffer, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += B32[bytes[i]! % 32];
  return out;
}

export interface MintedKey {
  /** Shown ONCE to the operator. Never stored, never logged. */
  plaintext: string;
  prefix: string;
  secretHash: string;
}

export function hashKey(plaintext: string, pepper: string): string {
  return createHmac("sha256", pepper).update(plaintext, "utf8").digest("hex");
}

export function mintKey(pepper: string): MintedKey {
  const prefix = base32(randomBytes(12), 12);
  const secret = randomBytes(32).toString("base64url");
  const plaintext = `${KEY_PREFIX}${prefix}_${secret}`;
  return { plaintext, prefix, secretHash: hashKey(plaintext, pepper) };
}

export function parseKey(presented: string): { prefix: string } | null {
  const m = KEY_RE.exec(presented.trim());
  return m ? { prefix: m[1]! } : null;
}

/** Constant-time comparison of a presented key against a stored hash. */
export function verifyKey(presented: string, storedHash: string, pepper: string): boolean {
  if (!parseKey(presented)) return false;
  const a = Buffer.from(hashKey(presented.trim(), pepper), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Pull a key from the request headers. Query-string keys are refused upstream. */
export function keyFromHeaders(h: { authorization?: string | undefined; "x-api-key"?: string | string[] | undefined }): string | null {
  const x = h["x-api-key"];
  if (typeof x === "string" && x.length > 0) return x;
  const auth = h.authorization;
  if (auth && /^Bearer\s+latchk_/.test(auth)) return auth.replace(/^Bearer\s+/, "");
  return null;
}
