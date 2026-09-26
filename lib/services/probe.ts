import { decrypt, type EncryptedValue } from "../infra/crypto";
import { config } from "../config/env";
import { logger } from "../infra/logger";
import type { Logger } from "../infra/logger";
import { AppError, isAppError } from "../domain/errors";
import type { CatalogSlugs, FetchStatus } from "../domain/provider";
import { fetchWithTimeout } from "../infra/http";
import { buildModelFetchAttempts } from "../upstream";
import type { UpstreamAttempt } from "../upstream";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** True when an error is a deterministic auth failure (401/403). */
export function isAuthFailure(details: unknown): boolean {
  if (details && typeof details === "object" && "status" in details) {
    const s = (details as { status?: unknown }).status;
    return s === 401 || s === 403;
  }
  return false;
}

/** True when an upstream error is an auth challenge or an optional endpoint absent. */
function isAuthOrUnsupportedStatus(details: unknown): boolean {
  if (details && typeof details === "object" && "status" in details) {
    const s = (details as { status?: unknown }).status;
    return s === 401 || s === 403 || s === 404;
  }
  return false;
}

async function runAttempt(
  attempt: UpstreamAttempt,
  log: Logger
): Promise<string[]> {
  const attempts = config.fetchRetries + 1;
  let lastError = "";
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetchWithTimeout(attempt.request.url, {
        headers: attempt.request.headers,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const msg = `HTTP ${res.status} ${res.statusText}${
          body ? `: ${body.slice(0, 200)}` : ""
        }`;
        if (isRetryableStatus(res.status) && i < attempts) {
          lastError = msg;
          log.warn(
            { attempt: attempt.name, try: i, status: res.status },
            "retryable upstream error"
          );
          await sleep(250 * i);
          continue;
        }
        throw AppError.upstream(msg, { status: res.status });
      }
      if (attempt.parseText) {
        return attempt.parseText(await res.text());
      }
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        throw AppError.upstream(`${attempt.name}: response was not valid JSON`);
      }
      return attempt.parse(json);
    } catch (err: unknown) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      const isNetwork = err instanceof TypeError;
      const message = isAbort
        ? `Request timed out after ${config.fetchTimeoutMs}ms`
        : err instanceof Error
          ? err.message
          : String(err);
      if ((isAbort || isNetwork) && i < attempts) {
        lastError = message;
        log.warn({ attempt: attempt.name, try: i }, `transient error: ${message}`);
        await sleep(250 * i);
        continue;
      }
      throw err instanceof AppError ? err : AppError.upstream(message);
    }
  }
  throw AppError.upstream(lastError || "Unknown error");
}

export interface ProbeInput {
  adapter: string;
  baseUrl: string;
  /** Decrypted API key to try, or null for a no-key probe. */
  key: string | null;
  catalogSlugs: CatalogSlugs;
}

export interface ProbeResult {
  status: FetchStatus;
  models: string[];
  error: string | null;
  /** True when every failure was a deterministic auth failure (401/403). */
  authFailed: boolean;
}

/**
 * Probe a provider's model list with a specific key (pure of persistence).
 * Reports whether the failure was an auth failure so the key pool can decide
 * to demote/delete the key (ADR-0011).
 */
export async function probeModels(input: ProbeInput): Promise<ProbeResult> {
  const log = logger.child({ baseUrl: input.baseUrl, adapter: input.adapter });
  const attempts = buildModelFetchAttempts({
    adapter: input.adapter,
    baseUrl: input.baseUrl,
    key: input.key,
    catalogSlugs: input.catalogSlugs,
  });

  const errors: string[] = [];
  let allAuthOrUnsupported = true;
  let anyAuthFailure = false;
  for (const attempt of attempts) {
    try {
      const models = await runAttempt(attempt, log);
      if (models.length > 0) {
        return { status: "ok", models: [...models].sort(), error: null, authFailed: false };
      }
      errors.push(`${attempt.name}: empty`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const authLike = isAppError(err) && isAuthOrUnsupportedStatus(err.details);
      if (!authLike) allAuthOrUnsupported = false;
      if (isAppError(err) && isAuthFailure(err.details)) anyAuthFailure = true;
      errors.push(`${attempt.name}: ${message}`);
    }
  }

  if (!input.key && errors.length > 0 && allAuthOrUnsupported) {
    return { status: "needs_key", models: [], error: null, authFailed: false };
  }
  return {
    status: "error",
    models: [],
    error: errors.join(" | ") || "No model source available",
    authFailed: anyAuthFailure && allAuthOrUnsupported,
  };
}

export function decryptKey(enc: EncryptedValue | null): string | null {
  return enc ? decrypt(enc) : null;
}
