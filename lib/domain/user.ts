import { z } from "zod";
import { AppError } from "./errors";

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

/**
 * Translate a raw UNIQUE violation from the users table into a clean
 * VALIDATION error. Callers pre-check the common case, but two concurrent
 * writers can still race past a check; the constraint is the backstop and
 * must surface as a 400, never a 500.
 */
export function throwUserUniqueAsValidation(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  if (/users\.email|users_email/.test(message)) {
    throw AppError.validation("邮箱已被占用");
  }
  if (/users\.username|users_username/.test(message)) {
    throw AppError.validation("用户名已被占用");
  }
  if (/users\.slug|users_slug/.test(message)) {
    throw AppError.validation("个人页路径已被占用");
  }
  throw err;
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

export const passwordSchema = z
  .string()
  .min(8, "密码至少 8 位")
  .max(200, "密码最多 200 位");

export const emailSchema = z
  .string()
  .trim()
  .min(1, "请填写邮箱")
  .email("邮箱格式不正确")
  .max(254, "邮箱过长");

export const roleSchema = z.enum(["admin", "user"]);
