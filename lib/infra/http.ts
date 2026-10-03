import { config } from "../config/env";
import { AppError } from "../domain/errors";

/**
 * SSRF guard for outbound fetches to user-supplied URLs.
 *
 * Site import, provider refresh and model probing all fetch a URL the user
 * typed, so an unguarded fetch lets any authenticated user reach loopback,
 * private ranges and cloud-metadata endpoints (169.254.169.254) — and read
 * the response back through the provider's `last_error` / import result.
 *
 * The check is on the LITERAL host: a hostname that resolves to a private
 * address is not caught here (that needs a DNS-aware guard), but every
 * literal spelling of an internal target is, which closes the practical
 * attack (loopback probing, metadata theft, port scanning).
 */

/** True when the host is loopback, private, link-local, or otherwise internal. */
export function isBlockedHost(rawHost: string): boolean {
  const host = rawHost.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return true;

  // Named loopback / wildcard spellings.
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0" ||
    host === "0.0.0.0" ||
    host === "::" ||
    host === "::1"
  ) {
    return true;
  }

  // IPv4 literal?
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if ([v4[1], v4[2], v4[3], v4[4]].some((o) => Number(o) > 255)) return true;
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local (cloud metadata)
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 0) return true; // "this network"
    return false;
  }

  // IPv6 literal (already stripped of brackets).
  if (host.includes(":")) {
    const h = host.split("%")[0]; // drop zone id
    if (h === "::1" || h === "::") return true;
    const first = h.split(":")[0];
    if (/^f[cd][0-9a-f]{2}$/.test(first)) return true; // fc00::/7 unique-local
    if (/^fe[89ab][0-9a-f]$/.test(first)) return true; // fe80::/10 link-local
    // IPv4-mapped (::ffff:127.0.0.1) — recurse on the embedded v4.
    const mapped = /::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h);
    if (mapped) return isBlockedHost(mapped[1]);
    return false;
  }

  return false;
}

/**
 * Throw a VALIDATION error when the URL is unsafe to fetch.
 *
 * Loopback/private targets are refused unless the operator opted in via
 * MODELHUB_ALLOW_PRIVATE_FETCH (self-hosted setups probing a LAN instance).
 * The opt-in exists because the check cannot tell an operator's own relay
 * from an attacker probing 169.254.169.254 — so the safe default wins.
 */
export function assertSafeUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw AppError.validation("链接格式不正确");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw AppError.validation("链接必须是 http 或 https");
  }
  if (isBlockedHost(url.hostname) && !config.allowPrivateFetch) {
    throw AppError.validation("该地址不允许访问");
  }
  return url;
}

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
  // Guard every outbound call here: this is the single choke point all
  // user-URL-driven fetches go through.
  assertSafeUrl(url);
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
