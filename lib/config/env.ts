import { z } from "zod";

/**
 * Central runtime configuration. Validated once at import time.
 * Fail-fast: a misconfigured process refuses to serve rather than
 * silently misbehaving.
 */

const rawSchema = z.preprocess(
  // Docker Compose injects "" for unset interpolated vars; treat empty (or
  // whitespace-only) values as unset so an unset DATABASE_URL is not rejected
  // and a stray "   " does not reach the pg driver.
  (raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      out[k] = typeof v === "string" && v.trim() === "" ? undefined : v;
    }
    return out;
  },
  z.object({
    MODELHUB_MASTER_KEY: z
      .string()
      .min(1, "MODELHUB_MASTER_KEY is required")
      .optional(),
    MODELHUB_ADMIN_PASSWORD: z.string().min(1).optional(),
    MODELHUB_DATA_PATH: z.string().optional(),
    DATABASE_DRIVER: z.enum(["sqlite", "postgres"]).optional(),
    DATABASE_URL: z.string().min(1).optional(),
    MODELHUB_REFRESH_INTERVAL_HOURS: z.coerce.number().positive().optional(),
    MODELHUB_FETCH_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
    MODELHUB_FETCH_RETRIES: z.coerce.number().int().min(0).max(5).optional(),
    MODELHUB_REFRESH_CONCURRENCY: z.coerce
      .number()
      .int()
      .positive()
      .max(32)
      .optional(),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .optional(),
    NODE_ENV: z.string().optional(),
  })
);

const parsed = rawSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "[config] invalid environment:",
    parsed.error.flatten().fieldErrors
  );
  throw new Error("Invalid environment configuration");
}

const env = parsed.data;

export const config = {
  masterKey: env.MODELHUB_MASTER_KEY ?? null,
  adminPassword: env.MODELHUB_ADMIN_PASSWORD ?? null,
  dataPath: env.MODELHUB_DATA_PATH ?? null, // resolved lazily by the repository
  databaseDriver: env.DATABASE_DRIVER ?? "sqlite",
  databaseUrl: env.DATABASE_URL ?? null,
  defaultRefreshIntervalHours: env.MODELHUB_REFRESH_INTERVAL_HOURS ?? 6,
  fetchTimeoutMs: env.MODELHUB_FETCH_TIMEOUT_MS ?? 15_000,
  fetchRetries: env.MODELHUB_FETCH_RETRIES ?? 2,
  refreshConcurrency: env.MODELHUB_REFRESH_CONCURRENCY ?? 4,
  logLevel: env.LOG_LEVEL ?? (env.NODE_ENV === "production" ? "info" : "debug"),
  isProduction: env.NODE_ENV === "production",
} as const;

export type Config = typeof config;
