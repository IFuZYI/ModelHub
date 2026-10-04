/**
 * Alibaba Cloud ESA / WAF "acw_sc__v2" anti-bot challenge solver.
 *
 * Some relay sites sit behind ESA with the "http_custom" deny rule: a plain
 * fetch (no JS) gets HTTP 200 whose body is a small HTML page that computes a
 * cookie (`acw_sc__v2`) via obfuscated JS and reloads. Until that cookie is
 * sent, every path — /api/status, /logo.png — keeps serving the challenge
 * (the logo answers a 307 redirect loop instead), so the site looks "down"
 * to any server-side client even though a browser loads it fine.
 *
 * The challenge script, decoded, does two things with the page's `arg1` hex
 * string: it reorders its characters through a fixed position table, then
 * XORs the reordered bytes (hex) with a fixed 40-char key. Both constants are
 * baked into the WAF's script; they were extracted from captured challenge
 * pages and verified by executing each page's own script in a VM and by
 * round-tripping the computed cookie against the live site.
 *
 * This is best-effort by design: if the WAF rotates its script and the
 * computed cookie stops being accepted, callers simply fall back to their
 * existing "challenge not passed" behavior (the importer stays best-effort).
 */

import { fetchWithTimeout } from "./http";

/** Name of the cookie the challenge sets and expects back. */
export const ACW_COOKIE_NAME = "acw_sc__v2";

/**
 * Fixed character-reorder table from the challenge script (`var m=[...]`):
 * POS[z] is the 1-based source index of the character that ends up at z.
 */
const POS = [
  15, 35, 29, 24, 33, 16, 1, 38, 10, 9, 19, 31, 40, 27, 22, 23, 25, 13, 6, 11,
  39, 18, 20, 8, 14, 21, 32, 26, 2, 30, 7, 4, 17, 5, 3, 28, 34, 37, 12, 36,
];

/** Fixed XOR key decoded from the challenge script's string table. */
const KEY = "3000176000856006061501533003690027800375";

/** `var arg1='<40 hex chars>'` — the per-response seed the cookie derives from. */
const ARG1_RE = /var\s+arg1\s*=\s*['"]([0-9A-Fa-f]{40})['"]/;

/**
 * Compute the `acw_sc__v2` value for a challenge page body.
 *
 * Returns null when the body is not an acw challenge (no arg1), so callers
 * can use this both as a detector and as the solver.
 */
export function solveAcwCookieValue(body: string): string | null {
  const m = ARG1_RE.exec(body);
  if (!m) return null;
  const arg1 = m[1];

  // Reorder arg1 through POS: q[z] = arg1[POS[z] - 1].
  const q: string[] = [];
  for (let x = 0; x < arg1.length; x++) {
    for (let z = 0; z < POS.length; z++) {
      if (POS[z] === x + 1) q[z] = arg1[x];
    }
  }
  const u = q.join("");

  // XOR hex pairs of the reordered seed with the key.
  let v = "";
  for (let x = 0; x < u.length && x < KEY.length; x += 2) {
    const xor = (
      parseInt(u.substring(x, x + 2), 16) ^
      parseInt(KEY.substring(x, x + 2), 16)
    ).toString(16);
    v += xor.length === 1 ? `0${xor}` : xor;
  }
  return v;
}

/**
 * Per-run challenge state: once one endpoint on a site has been solved, the
 * cookie is sent proactively on every later request of the same run — the WAF
 * cookie is session-scoped and re-solving per URL wastes round-trips.
 */
export interface AcwChallengeSession {
  cookie: string | null;
}

/** Fresh session (no cookie solved yet). */
export function newAcwChallengeSession(): AcwChallengeSession {
  return { cookie: null };
}

/**
 * GET a URL as text, transparently passing a solved acw challenge:
 *   - sends the session's cookie when one was already solved, and
 *   - when the response body is a solvable challenge, computes the cookie,
 *     records it on the session, and retries once.
 *
 * Returns the raw Response of the (possibly retried) fetch; callers parse it
 * as JSON or text as they normally would. Non-challenge bodies and sites
 * without a WAF cost nothing extra — the body is only read as text here, and
 * callers use `res.text()`/`res.json()` on the SAME Response (its body is
 * still unread).
 *
 * Note: reading the body to detect the challenge consumes the first
 * Response's stream, so on a retry the returned Response is the second one.
 */
export async function fetchTextSolvingAcwChallenge(
  url: string,
  init: RequestInit,
  session?: AcwChallengeSession
): Promise<Response> {
  const withCookie = (): RequestInit => {
    if (!session?.cookie) return init;
    const headers = new Headers(init.headers);
    headers.set("Cookie", session.cookie);
    return { ...init, headers };
  };

  let res = await fetchWithTimeout(url, withCookie());
  if (!res.ok) return res;

  // Challenges are served as HTML; JSON/binary payloads pass through without
  // reading the body (no cost on non-WAF sites, no buffering of large lists).
  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  if (ct && !ct.includes("text/html")) return res;

  const body = await res.text();
  const solved = solveAcwCookieValue(body);
  if (!solved) {
    // Not a challenge: hand back a Response carrying the already-read body so
    // the caller still sees the normal payload (e.g. an SPA HTML shell). The
    // body is decoded (undici decompresses transparently), so the wire-level
    // encoding/length headers must not ride along — a later .json()/.text()
    // would otherwise try to decode the bytes a second time.
    const headers = new Headers(res.headers);
    headers.delete("content-encoding");
    headers.delete("content-length");
    return new Response(body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  }

  if (session) session.cookie = `${ACW_COOKIE_NAME}=${solved}`;
  res = await fetchWithTimeout(url, withCookie());
  return res;
}
