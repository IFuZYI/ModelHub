import crypto from "crypto";
import { cookies } from "next/headers";
import { config } from "../config/env";
import { AppError } from "../domain/errors";
import type { Role } from "../domain/user";
import { getDatabase } from "../infra/db";
import { UserRepository } from "../infra/repositories/userRepo";
import { verifyPassword as verifyHash } from "../infra/password";

/**
 * Multi-user session auth (ADR-0009). Stateless HMAC cookie carrying
 * `userId.role.tokenVersion.expiry.signature`. Revocation is achieved by
 * bumping the user's token_version. Signing key derives from the master key.
 */

const COOKIE_NAME = "modelhub_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface Session {
  userId: string;
  role: Role;
  tokenVersion: number;
}

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

/** Encode a signed session token (payload segments are base64url-safe). */
export function createToken(session: Session, now = Date.now()): string {
  const expiry = now + SESSION_TTL_MS;
  const payload = [
    Buffer.from(session.userId).toString("base64url"),
    session.role,
    String(session.tokenVersion),
    String(expiry),
  ].join(".");
  return `${payload}.${sign(payload)}`;
}

/** Parse + verify a token's signature and expiry (not the DB token_version). */
export function parseToken(token: string | undefined): Session | null {
  if (!token) return null;
  const lastDot = token.lastIndexOf(".");
  if (lastDot < 0) return null;
  const payload = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);
  if (!timingSafeEqual(sig, sign(payload))) return null;
  const parts = payload.split(".");
  if (parts.length !== 4) return null;
  const [uid64, role, tv, exp] = parts;
  if (role !== "admin" && role !== "user") return null;
  const expiry = Number(exp);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) return null;
  const tokenVersion = Number(tv);
  if (!Number.isInteger(tokenVersion)) return null;
  let userId: string;
  try {
    userId = Buffer.from(uid64, "base64url").toString("utf8");
  } catch {
    return null;
  }
  return { userId, role, tokenVersion };
}

export function verifyPassword(plain: string, storedHash: string): boolean {
  return verifyHash(plain, storedHash);
}

export const sessionCookieName = COOKIE_NAME;
export const sessionMaxAgeSeconds = SESSION_TTL_MS / 1000;

/** Whether any admin account is provisioned (install-flow gate). */
export async function adminConfigured(): Promise<boolean> {
  const users = new UserRepository(getDatabase());
  return (await users.count()) > 0;
}

/**
 * Resolve the current session from the cookie AND validate it against the DB
 * (user still exists, active, token_version + role match). Returns null for a
 * guest. Authoritative check used by guards.
 */
export async function currentUser(): Promise<Session | null> {
  const store = await cookies();
  const parsed = parseToken(store.get(COOKIE_NAME)?.value);
  if (!parsed) return null;
  const user = await new UserRepository(getDatabase()).getById(parsed.userId);
  if (!user || user.status !== "active") return null;
  if (user.token_version !== parsed.tokenVersion) return null;
  if (user.role !== parsed.role) return null;
  return parsed;
}

/** True when a valid session cookie is present. */
export async function isAuthenticated(): Promise<boolean> {
  return (await currentUser()) !== null;
}

/** Throw 401 unless logged in; returns the session. */
export async function requireUser(): Promise<Session> {
  const session = await currentUser();
  if (!session) throw AppError.unauthorized();
  return session;
}

/** Throw 401/403 unless the caller is an admin; returns the session. */
export async function requireAdmin(): Promise<Session> {
  const session = await requireUser();
  if (session.role !== "admin") {
    throw AppError.unauthorized("Admin privileges required");
  }
  return session;
}
