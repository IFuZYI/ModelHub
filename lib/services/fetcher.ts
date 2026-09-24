import { decrypt } from "../infra/crypto";
import { config } from "../config/env";
import { logger } from "../infra/logger";
import type { Logger } from "../infra/logger";
import { AppError, isAppError } from "../domain/errors";
import { StoredProvider } from "../domain/provider";
import { fileRepository, ProviderRepository } from "../infra/repository";
import { fetchWithTimeout } from "../infra/http";
import { getAdapter } from "../upstream";
import type { UpstreamAttempt } from "../upstream";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** True when an AppError.upstream detail marks a 401/403 auth challenge. */
function isAuthStatus(details: unknown): boolean {
  if (details && typeof details === "object" && "status" in details) {
    const s = (details as { status?: unknown }).status;
    return s === 401 || s === 403;
  }
  return false;
}

/**
 * Run one upstream attempt (e.g. /api/pricing or /v1/models) with timeout and
 * bounded retries on transient failures. Returns the parsed model list, or
 * throws AppError.upstream on a hard failure so the caller can fall through to
 * the next attempt.
 */
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
      // Guard non-JSON / malformed bodies with a clear, terminal error.
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        throw AppError.upstream(`${attempt.name}: response was not valid JSON`);
      }
      return attempt.parse(json);
    } catch (err: unknown) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      // fetch() rejects with a TypeError for network-level failures
      // (DNS, connection refused, TLS). Those are transient — retry them too.
      const isNetwork = err instanceof TypeError;
      const message = isAbort
        ? `Request timed out after ${config.fetchTimeoutMs}ms`
        : err instanceof Error
          ? err.message
          : String(err);
      // Retry network/timeout; a thrown AppError (bad status/shape) is terminal.
      if ((isAbort || isNetwork) && i < attempts) {
        lastError = message;
        log.warn(
          { attempt: attempt.name, try: i },
          `transient error: ${message}`
        );
        await sleep(250 * i);
        continue;
      }
      throw err instanceof AppError ? err : AppError.upstream(message);
    }
  }
  throw AppError.upstream(lastError || "Unknown error");
}

/**
 * Fetches and normalizes a provider's model list via its upstream adapter,
 * trying each attempt in order (e.g. pricing → /v1/models) and using the first
 * that yields a non-empty list. Pure of persistence — returns the next
 * StoredProvider state. On total failure the previously cached models are kept.
 */
export async function fetchProviderModels(
  provider: StoredProvider
): Promise<StoredProvider> {
  const now = () => new Date().toISOString();
  const log = logger.child({ providerId: provider.id, name: provider.name });

  // Manual-model providers (no usable listing endpoint) keep their built-in
  // list — a scheduled refresh must never clear or overwrite it.
  if (provider.manual_models) {
    log.info(
      { modelCount: provider.models.length },
      "manual models; skip fetch"
    );
    return {
      ...provider,
      last_fetched: now(),
      last_status: provider.models.length > 0 ? "ok" : "pending",
      last_error: null,
      updated_at: now(),
    };
  }

  const adapter = getAdapter(provider.adapter);
  const key = provider.key_enc ? decrypt(provider.key_enc) : null;
  const attempts = adapter.buildAttempts(provider.base_url, key);

  const errors: string[] = [];
  let sawAuthError = false; // any attempt failed purely on 401/403
  for (const attempt of attempts) {
    try {
      const models = await runAttempt(attempt, log);
      if (models.length > 0) {
        log.info({ via: attempt.name, modelCount: models.length }, "fetch ok");
        return {
          ...provider,
          models: [...models].sort(),
          last_fetched: now(),
          last_status: "ok",
          last_error: null,
          updated_at: now(),
        };
      }
      log.warn(
        { via: attempt.name },
        "attempt returned no models; trying next"
      );
      errors.push(`${attempt.name}: empty`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (isAppError(err) && isAuthStatus(err.details)) sawAuthError = true;
      log.warn({ via: attempt.name }, `attempt failed: ${message}`);
      errors.push(`${attempt.name}: ${message}`);
    }
  }

  // No key stored + every failure was an auth challenge (401/403): this is an
  // expected "needs a key" state, not a broken provider. Keep seed models and
  // flag it distinctly so the UI can prompt for a key instead of "刷新失败".
  if (!key && sawAuthError) {
    log.info({ errors }, "auth required; awaiting API key");
    return {
      ...provider,
      last_fetched: now(),
      last_status: "needs_key",
      last_error: null,
      updated_at: provider.updated_at,
    };
  }

  // All attempts exhausted — preserve cached models, record why.
  log.error({ errors }, "all fetch attempts failed");
  return {
    ...provider,
    last_fetched: now(),
    last_status: "error",
    last_error: errors.join(" | ") || "No model source available",
  };
}

/** Fetch + persist one provider. */
export async function refreshProvider(
  provider: StoredProvider,
  repo: ProviderRepository = fileRepository
): Promise<StoredProvider> {
  const updated = await fetchProviderModels(provider);
  await repo.upsert(updated);
  return updated;
}

/**
 * Refresh all providers with bounded concurrency, isolating per-provider
 * failures so one bad provider never blocks the others.
 */
export async function refreshAll(
  repo: ProviderRepository = fileRepository
): Promise<void> {
  const data = await repo.read();
  const queue = [...data.providers];
  const workers = Math.min(config.refreshConcurrency, queue.length || 1);

  async function worker() {
    for (;;) {
      const p = queue.shift();
      if (!p) return;
      await refreshProvider(p, repo).catch((e) =>
        logger.error({ err: String(e) }, "refreshAll worker error")
      );
    }
  }

  await Promise.all(Array.from({ length: workers }, worker));
  logger.info({ count: data.providers.length }, "refreshAll complete");
}
