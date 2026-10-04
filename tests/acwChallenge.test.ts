import { describe, it, expect } from "vitest";
import http from "http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  solveAcwCookieValue,
  fetchTextSolvingAcwChallenge,
  newAcwChallengeSession,
  ACW_COOKIE_NAME,
} from "@/lib/infra/acwChallenge";

const ROOT = new URL("..", import.meta.url).pathname;
const fixture = (name: string) =>
  readFileSync(join(ROOT, "tests/fixtures", name), "utf8");

/**
 * The fixtures are real challenge pages captured from anyrouter.top (an ESA
 * "http_custom" anti-bot page). Ground truth: executing each captured page's
 * own script (in a VM) computes the cookie below; fixture 1's cookie was
 * additionally round-tripped against the live site — sent back, it returns
 * the real /api/status JSON instead of the challenge.
 */
describe("solveAcwCookieValue", () => {
  it("computes the cookie for real captured challenge pages", () => {
    expect(solveAcwCookieValue(fixture("acw-challenge-1.html"))).toBe(
      "6ac21bd3de4e480b2df6aefeeab09f2aedea0666"
    );
    expect(solveAcwCookieValue(fixture("acw-challenge-2.html"))).toBe(
      "6ac21ff6af1afc0fb4be2d1b937cf5a21071a83e"
    );
  });

  it("returns null when the body is not an acw challenge", () => {
    expect(
      solveAcwCookieValue('{"data":{"system_name":"Cat API"}}')
    ).toBeNull();
    expect(
      solveAcwCookieValue("<!doctype html><html><body>SPA shell</body></html>")
    ).toBeNull();
    expect(solveAcwCookieValue("")).toBeNull();
  });

  it("uses the acw_sc__v2 cookie name the challenge sets", () => {
    expect(ACW_COOKIE_NAME).toBe("acw_sc__v2");
  });
});

describe("fetchTextSolvingAcwChallenge", () => {
  it("retries WITH the solved cookie even when no session was passed", async () => {
    // Regression guard: with an optional session, a naive implementation only
    // remembers the cookie on the session — with none, the retry goes out
    // cookie-less and gets the challenge again, silently wasting a round-trip.
    const challenge = fixture("acw-challenge-1.html");
    const cookieValue = "6ac21bd3de4e480b2df6aefeeab09f2aedea0666";
    const seen: ("none" | "cookie")[] = [];
    const site = http.createServer((req, res) => {
      const ok = (req.headers.cookie ?? "").includes(
        `acw_sc__v2=${cookieValue}`
      );
      seen.push(ok ? "cookie" : "none");
      if (req.url?.endsWith("/api/status")) {
        if (!ok) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          return res.end(challenge);
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(
          JSON.stringify({ success: true, data: { system_name: "NoSession" } })
        );
      }
      res.writeHead(404);
      res.end("x");
    });
    await new Promise<void>((r) => site.listen(0, "127.0.0.1", () => r()));
    const base = `http://127.0.0.1:${(site.address() as { port: number }).port}`;
    try {
      const res = await fetchTextSolvingAcwChallenge(
        `${base}/api/status`,
        { headers: { Accept: "application/json" } }
        // deliberately NO session argument
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.system_name).toBe("NoSession");
      // Two requests: challenge, then the retry — and the retry carried it.
      expect(seen).toEqual(["none", "cookie"]);
    } finally {
      await new Promise<void>((r) => site.close(() => r()));
    }
  });

  it("does NOT send a solved cookie to a different origin", async () => {
    // Security regression guard: a probe run shares one session across every
    // attempt, including third-party catalog hosts (models.dev, raw.github
    // usercontent.com, custom catalog URLs). The cookie was minted for the
    // provider's origin and must never leak to unrelated hosts.
    const challenge = fixture("acw-challenge-1.html");
    const cookieValue = "6ac21bd3de4e480b2df6aefeeab09f2aedea0666";
    const provider = http.createServer((req, res) => {
      if (req.url?.endsWith("/api/status")) {
        if (!(req.headers.cookie ?? "").includes(`acw_sc__v2=${cookieValue}`)) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          return res.end(challenge);
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ data: { system_name: "P" } }));
      }
      res.writeHead(404);
      res.end("x");
    });
    const cookiesSeenByCatalog: string[] = [];
    const catalog = http.createServer((req, res) => {
      cookiesSeenByCatalog.push(req.headers.cookie ?? "");
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("catalog-model-1\n");
    });
    await new Promise<void>((r) => provider.listen(0, "127.0.0.1", () => r()));
    await new Promise<void>((r) => catalog.listen(0, "127.0.0.1", () => r()));
    const pBase = `http://127.0.0.1:${(provider.address() as { port: number }).port}`;
    const cBase = `http://127.0.0.1:${(catalog.address() as { port: number }).port}`;
    try {
      const session = newAcwChallengeSession();
      // 1. Solve on the provider origin.
      await fetchTextSolvingAcwChallenge(
        `${pBase}/api/status`,
        { headers: { Accept: "application/json" } },
        session
      );
      expect(session.cookie).not.toBeNull();
      // 2. Fetch a different origin with the same session — no cookie.
      const res2 = await fetchTextSolvingAcwChallenge(
        `${cBase}/models.txt`,
        { headers: { Accept: "text/plain" } },
        session
      );
      expect(await res2.text()).toContain("catalog-model-1");
      expect(cookiesSeenByCatalog).toEqual([""]);
    } finally {
      await new Promise<void>((r) => provider.close(() => r()));
      await new Promise<void>((r) => catalog.close(() => r()));
    }
  });

  it("returns ok-but-bodyless responses (204/205) untouched instead of throwing", async () => {
    // Regression guard: rebuilding `new Response("", { status: 204 })` throws
    // `TypeError: Response constructor: Invalid response status code 204`.
    // probe.ts treats TypeErrors as transient network errors, so every
    // attempt retried with backoff and the run misclassified as "error"
    // instead of the previous "needs_key" (allAuthOrUnsupported).
    for (const status of [204, 205] as const) {
      const site = http.createServer((req, res) => {
        res.writeHead(status);
        res.end();
      });
      await new Promise<void>((r) => site.listen(0, "127.0.0.1", () => r()));
      const base = `http://127.0.0.1:${(site.address() as { port: number }).port}`;
      try {
        const res = await fetchTextSolvingAcwChallenge(`${base}/api/status`, {
          headers: { Accept: "application/json" },
        });
        expect(res.status).toBe(status);
        expect(await res.text()).toBe("");
      } finally {
        await new Promise<void>((r) => site.close(() => r()));
      }
    }
  });
});
