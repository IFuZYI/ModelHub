import { describe, it, expect } from "vitest";
import http from "http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { probeModels } from "@/lib/services/probe";

/**
 * Model refresh behind an ESA acw challenge: the same WAF that guards
 * /api/status (see tests/fixtures) also answers /api/pricing with the JS
 * challenge page. A plain fetch never executes it, so the attempt reads as
 * "not valid JSON" and the whole probe degrades to needs_key — even though
 * sending back the solved cookie returns the real model list (verified
 * against the live site). The fetcher must solve the challenge and retry.
 */
const ROOT = new URL("..", import.meta.url).pathname;
const challenge = readFileSync(
  join(ROOT, "tests/fixtures/acw-challenge-1.html"),
  "utf8"
);
const COOKIE = "6ac21bd3de4e480b2df6aefeeab09f2aedea0666";

describe("probeModels behind an ESA acw challenge", () => {
  it("solves the challenge on /api/pricing and returns its models", async () => {
    const site = http.createServer((req, res) => {
      const url = req.url ?? "";
      const ok = (req.headers.cookie ?? "").includes(`acw_sc__v2=${COOKIE}`);
      if (url.endsWith("/api/pricing")) {
        if (!ok) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          return res.end(challenge);
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(
          JSON.stringify({
            success: true,
            data: [
              { model_name: "challenged-1" },
              { model_name: "challenged-2" },
            ],
          })
        );
      }
      // /v1/models rejects keyless probes: if the pricing solve fails, the
      // probe degrades to needs_key and this test fails on the model list.
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, message: "Unauthorized" }));
    });
    await new Promise<void>((r) => site.listen(0, "127.0.0.1", () => r()));
    const base = `http://127.0.0.1:${(site.address() as { port: number }).port}`;
    try {
      const r = await probeModels({
        adapter: "openai-compatible",
        baseUrl: base,
        key: null,
        catalogSlugs: {},
      });
      expect(r.status).toBe("ok");
      expect(r.models).toEqual(["challenged-1", "challenged-2"]);
    } finally {
      await new Promise<void>((r) => site.close(() => r()));
    }
  });

  it("reuses the solved cookie for later attempts instead of re-solving", async () => {
    // pricing: challenge → (cookie) empty list. /v1/models: challenge → (cookie)
    // models. Once pricing solved the cookie, the models attempt must send it
    // proactively — the WAF cookie is session-scoped, one solve per run.
    const modelsRequests: ("none" | "cookie")[] = [];
    const site = http.createServer((req, res) => {
      const url = req.url ?? "";
      const ok = (req.headers.cookie ?? "").includes(`acw_sc__v2=${COOKIE}`);
      if (url.endsWith("/api/pricing")) {
        if (!ok) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          return res.end(challenge);
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ success: true, data: [] }));
      }
      if (url.endsWith("/v1/models")) {
        modelsRequests.push(ok ? "cookie" : "none");
        if (!ok) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          return res.end(challenge);
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ data: [{ id: "models-1" }] }));
      }
      res.writeHead(404);
      res.end("x");
    });
    await new Promise<void>((r) => site.listen(0, "127.0.0.1", () => r()));
    const base = `http://127.0.0.1:${(site.address() as { port: number }).port}`;
    try {
      const r = await probeModels({
        adapter: "openai-compatible",
        baseUrl: base,
        key: "sk-test",
        catalogSlugs: {},
      });
      expect(r.models).toEqual(["models-1"]);
      // The FIRST /v1/models request already carried the cookie — no second
      // challenge round-trip for a cookie this run already solved.
      expect(modelsRequests).toEqual(["cookie"]);
    } finally {
      await new Promise<void>((r) => site.close(() => r()));
    }
  });
});
