import crypto from "crypto";
import { cookies } from "next/headers";
import { config } from "../config/env";
import { AppError } from "../domain/errors";

/**
 * Minimal single-admin session auth for the console.
 *
 * - Login: constant-time compare against MODELHUB_ADMIN_PASSWORD, then issue an
 *   HMAC-signed cookie (`expiry.signature`) — no server-side session store.
 * - Public read endpoints never require auth; only writes and /admin do.
 */

const COOKIE_NAME = "modelhub_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function signingKey(): Buffer {
  const raw = config.masterKey ?? config.adminPassword ?? "";
  return crypto.createHash("sha256").update(`session:${raw}`).digest();
}

function sign(value: string): string {
  return crypto.createHmac("sha256", signingKey()).update(value).digest("hex");
}

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function adminConfigured(): boolean {
  return config.adminPassword !== null;
}

/** Verify a plaintext password against the configured admin password. */
export function verifyPassword(password: string): boolean {
  if (!config.adminPassword) {
    throw AppError.config(
      "MODELHUB_ADMIN_PASSWORD is not set; admin login is disabled"
    );
  }
  return timingSafeEqual(password, config.adminPassword);
}

/** Build a signed session token valid for SESSION_TTL_MS from `now`. */
export function createToken(now = Date.now()): string {
  const expiry = String(now + SESSION_TTL_MS);
  return `${expiry}.${sign(expiry)}`;
}

/** Validate a session token's signature and expiry. */
export function verifyToken(token: string | undefined): boolean {
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return false;
  const expiry = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!timingSafeEqual(sig, sign(expiry))) return false;
  const exp = Number(expiry);
  return Number.isFinite(exp) && exp > Date.now();
}

export const sessionCookieName = COOKIE_NAME;
export const sessionMaxAgeSeconds = SESSION_TTL_MS / 1000;

/** Server-side check for route handlers / server components. */
export async function isAuthenticated(): Promise<boolean> {
  const store = await cookies();
  return verifyToken(store.get(COOKIE_NAME)?.value);
}

/** Throw 401 unless the current request carries a valid session. */
export async function requireAdmin(): Promise<void> {
  if (!(await isAuthenticated())) {
    throw AppError.unauthorized();
  }
}
