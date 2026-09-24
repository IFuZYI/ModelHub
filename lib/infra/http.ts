import { config } from "../config/env";

/**
 * fetch() with an AbortController timeout. Shared by the model fetcher and the
 * newapi importer so timeout/abort behavior is consistent in one place.
 *
 * Rejects with an AbortError (err.name === "AbortError") on timeout, and with
 * a TypeError on network-level failure (DNS, refused, TLS) — callers decide
 * whether those are retryable.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = config.fetchTimeoutMs
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      cache: "no-store",
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
