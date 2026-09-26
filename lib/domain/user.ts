import { z } from "zod";

/** User roles. `guest` is not a stored record — it means "not logged in". */
export type Role = "admin" | "user";
export type UserStatus = "active" | "disabled";

/** A stored user account. Never expose `password_hash` in an API response. */
export interface User {
  id: string;
  username: string;
  email: string | null;
  password_hash: string;
  role: Role;
  status: UserStatus;
  token_version: number;
  /** Personal-page slug (12-char alnum), or null when none assigned. */
  slug: string | null;
  created_at: string;
  updated_at: string;
}

/** Client-safe projection: identity without any credential material. */
export interface UserView {
  id: string;
  username: string;
  email: string | null;
  role: Role;
  status: UserStatus;
  slug: string | null;
  created_at: string;
  updated_at: string;
}

export function toUserView(u: User): UserView {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    role: u.role,
    status: u.status,
    slug: u.slug,
    created_at: u.created_at,
    updated_at: u.updated_at,
  };
}

/** Path segments a personal-page slug must never collide with (ADR-0012). */
export const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "login",
  "logout",
  "register",
  "console",
  "settings",
  "users",
  "providers",
  "health",
  "_next",
  "favicon.ico",
]);

const SLUG_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const SLUG_LENGTH = 12;

/** True when a string is a well-formed 12-char lowercase-alnum slug. */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]{12}$/.test(slug) && !RESERVED_SLUGS.has(slug);
}

/**
 * Generate a random 12-char alphanumeric slug. Callers must re-roll on the
 * (astronomically unlikely) reserved-word or uniqueness collision.
 */
export function generateSlug(
  randomInt: (max: number) => number = (max) =>
    Math.floor(Math.random() * max)
): string {
  let out = "";
  for (let i = 0; i < SLUG_LENGTH; i++) {
    out += SLUG_ALPHABET[randomInt(SLUG_ALPHABET.length)];
  }
  return RESERVED_SLUGS.has(out) ? generateSlug(randomInt) : out;
}

export const usernameSchema = z
  .string()
  .trim()
  .min(3, "用户名至少 3 个字符")
  .max(32)
  .regex(/^[a-zA-Z0-9_.-]+$/, "用户名只能含字母、数字、_ . -");

export const passwordSchema = z.string().min(8, "密码至少 8 位").max(200);

export const emailSchema = z.string().trim().email().max(254);

export const roleSchema = z.enum(["admin", "user"]);
