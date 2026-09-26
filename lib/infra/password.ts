import crypto from "crypto";

/**
 * Password hashing with Node's built-in scrypt (ADR-0009) — no native deps.
 * Stored form: `scrypt$N$r$p$saltB64$hashB64`. Verification is constant-time.
 */

const N = 16384; // CPU/memory cost
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;

export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(SALT_BYTES);
  const derived = crypto.scryptSync(plain, salt, KEYLEN, { N, r: R, p: P });
  return [
    "scrypt",
    N,
    R,
    P,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

export function verifyPassword(plain: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], "base64");
    expected = Buffer.from(parts[5], "base64");
  } catch {
    return false;
  }
  let derived: Buffer;
  try {
    derived = crypto.scryptSync(plain, salt, expected.length, { N: n, r, p });
  } catch {
    return false;
  }
  return (
    derived.length === expected.length &&
    crypto.timingSafeEqual(derived, expected)
  );
}
