import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import { probeModels } from "@/lib/services/probe";

/**
 * Proves the newapi model-fetch PRIORITY: /api/pricing must win over
 * /v1/models when both return a non-empty list. The site below serves
 * deliberately different lists on each endpoint, so the result identifies
 * which one the fetcher actually used.
 */
let server: http.Server;
let base = "";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? "";
    if (url.endsWith("/api/pricing")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({
          success: true,
          data: [{ model_name: "from-pricing-1" }, { model_name: "from-pricing-2" }],
        })
      );
    }
    if (url.endsWith("/v1/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data: [{ id: "from-v1-models" }] }));
    }
    res.writeHead(404);
    res.end("x");
  });
  await new Promise<void>((r) =>
    server.listen(0, "127.0.0.1", () => {
      base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      r();
    })
  );
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("newapi model-fetch priority", () => {
  it("/api/pricing wins over /v1/models when both are non-empty", async () => {
    const r = await probeModels({
      adapter: "openai-compatible",
      baseUrl: base,
      key: "sk-test",
      catalogSlugs: {},
    });
    expect(r.status).toBe("ok");
    expect(r.models).toEqual(["from-pricing-1", "from-pricing-2"]);
    expect(r.models).not.toContain("from-v1-models");
  });

  it("falls through to /v1/models when pricing yields an empty list", async () => {
    const emptyPricing = http.createServer((req, res) => {
      const url = req.url ?? "";
      if (url.endsWith("/api/pricing")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ success: true, data: [] }));
      }
      if (url.endsWith("/v1/models")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ data: [{ id: "fallback-model" }] }));
      }
      res.writeHead(404);
      res.end("x");
    });
    await new Promise<void>((r) => emptyPricing.listen(0, "127.0.0.1", () => r()));
    const b = `http://127.0.0.1:${(emptyPricing.address() as { port: number }).port}`;
    try {
      const r = await probeModels({
        adapter: "openai-compatible",
        baseUrl: b,
        key: "sk-test",
        catalogSlugs: {},
      });
      expect(r.models).toEqual(["fallback-model"]);
    } finally {
      await new Promise<void>((r) => emptyPricing.close(() => r()));
    }
  });

  it("sends the key to /v1/models but pricing still works without one", async () => {
    const seen: { url: string; auth?: string }[] = [];
    const spyServer = http.createServer((req, res) => {
      const url = req.url ?? "";
      seen.push({ url, auth: req.headers.authorization as string | undefined });
      if (url.endsWith("/api/pricing")) {
        // pricing rejects any key — must not stop the chain when keyless too
        if (req.headers.authorization) {
          res.writeHead(401, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ success: false }));
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ data: [{ model_name: "public-model" }] }));
      }
      if (url.endsWith("/v1/models")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ data: [{ id: "keyed-model" }] }));
      }
      res.writeHead(404);
      res.end("x");
    });
    await new Promise<void>((r) => spyServer.listen(0, "127.0.0.1", () => r()));
    const b = `http://127.0.0.1:${(spyServer.address() as { port: number }).port}`;
    try {
      const r = await probeModels({
        adapter: "openai-compatible",
        baseUrl: b,
        key: null,
        catalogSlugs: {},
      });
      expect(r.models).toEqual(["public-model"]);
      expect(seen[0].url).toContain("/api/pricing");
      expect(seen[0].auth).toBeUndefined();
    } finally {
      await new Promise<void>((r) => spyServer.close(() => r()));
    }
  });

  it("reports a clean (non-doubled) attempt name on a parse failure", async () => {
    const htmlServer = http.createServer((req, res) => {
      // SPA catch-all: every path returns HTML with 200
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<!doctype html><html></html>");
    });
    await new Promise<void>((r) => htmlServer.listen(0, "127.0.0.1", () => r()));
    const b = `http://127.0.0.1:${(htmlServer.address() as { port: number }).port}`;
    try {
      const r = await probeModels({
        adapter: "openai-compatible",
        baseUrl: b,
        key: null,
        catalogSlugs: {},
      });
      // Every endpoint is an unsupported HTML catch-all and no key is set, so
      // this is "site needs a key" rather than a hard error.
      expect(r.status).toBe("needs_key");
      expect(r.error).toBeNull();
    } finally {
      await new Promise<void>((r) => htmlServer.close(() => r()));
    }
  });

  it("classifies a key-requiring site as needs_key when /models is an SPA catch-all", async () => {
    // Real pattern (e.g. api.biliksir.ggff.net): pricing + /v1/models return
    // 401, while /models returns the frontend's HTML shell with HTTP 200.
    const site = http.createServer((req, res) => {
      const url = req.url ?? "";
      if (url.endsWith("/api/pricing") || url.endsWith("/v1/models")) {
        res.writeHead(401, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ success: false, message: "Unauthorized" }));
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<!doctype html><html></html>");
    });
    await new Promise<void>((r) => site.listen(0, "127.0.0.1", () => r()));
    const b = `http://127.0.0.1:${(site.address() as { port: number }).port}`;
    try {
      const keyless = await probeModels({
        adapter: "openai-compatible",
        baseUrl: b,
        key: null,
        catalogSlugs: {},
      });
      expect(keyless.status).toBe("needs_key");

      // With a key supplied it is a real error (the key was rejected).
      const keyed = await probeModels({
        adapter: "openai-compatible",
        baseUrl: b,
        key: "sk-bad",
        catalogSlugs: {},
      });
      expect(keyed.status).toBe("error");
      expect(keyed.authFailed).toBe(true);
    } finally {
      await new Promise<void>((r) => site.close(() => r()));
    }
  });
});
