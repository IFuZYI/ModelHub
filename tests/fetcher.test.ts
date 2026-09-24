import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import http from "http";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "modelhub-fetch-"));
process.env.MODELHUB_DATA_PATH = path.join(dir, "data.json");
process.env.MODELHUB_MASTER_KEY = Buffer.alloc(32, 9).toString("base64");
process.env.MODELHUB_FETCH_RETRIES = "1";
process.env.MODELHUB_FETCH_TIMEOUT_MS = "2000";

const { encrypt } = await import("@/lib/infra/crypto");
const { refreshProvider } = await import("@/lib/services/fetcher");
const { fileRepository: repo } = await import("@/lib/infra/repository");
import type { StoredProvider } from "@/lib/domain/provider";

let server: http.Server;
let port = 0;
// Controls what the mock upstream does per endpoint.
let pricing: "ok" | "404" | "500-then-ok" | "html" = "ok";
let models: "ok" | "401" = "ok";
let modelsRoot: "ok" | "404" = "404";
let pricingHits = 0;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? "";
    const auth = req.headers["authorization"] ?? "";
    if (url.endsWith("/api/pricing")) {
      pricingHits++;
      if (pricing === "404") {
        res.writeHead(404);
        return res.end("no pricing");
      }
      if (pricing === "html") {
        // 200 OK but a non-JSON body (e.g. a Cloudflare interstitial).
        res.writeHead(200, { "Content-Type": "text/html" });
        return res.end("<!DOCTYPE html><html>nope</html>");
      }
      if (pricing === "500-then-ok" && pricingHits === 1) {
        res.writeHead(500);
        return res.end("boom");
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({ data: [{ model_name: "p-b" }, { model_name: "p-a" }] })
      );
    }
    if (url.endsWith("/v1/models")) {
      if (models === "401" || auth !== "Bearer sk-test") {
        res.writeHead(401);
        return res.end("unauthorized");
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data: [{ id: "m-b" }, { id: "m-a" }] }));
    }
    // {base}/models — the version-in-base fallback (Zhipu v4, Gemini, ...).
    if (url.endsWith("/models")) {
      if (modelsRoot === "404") {
        res.writeHead(404);
        return res.end("nope");
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data: [{ id: "r-b" }, { id: "r-a" }] }));
    }
    res.writeHead(404);
    res.end("nope");
  });
  await new Promise<void>((r) =>
    server.listen(0, "127.0.0.1", () => {
      port = (server.address() as { port: number }).port;
      r();
    })
  );
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

beforeEach(() => {
  pricingHits = 0;
  pricing = "ok";
  models = "ok";
  modelsRoot = "404";
});

function makeProvider(withKey = true): StoredProvider {
  return {
    id: "33333333-3333-3333-3333-333333333333",
    name: "mock",
    type: "newapi",
    // base_url is WITHOUT /v1 — the adapter appends /api/pricing and /v1/models.
    base_url: `http://127.0.0.1:${port}`,
    aff_code: null,
    adapter: "openai-compatible",
    key_enc: withKey ? encrypt("sk-test") : null,
    manual_models: false,
    icon: null,
    register_methods: [],
    models: [],
    last_fetched: null,
    last_status: "pending",
    last_error: null,
    updated_at: null,
  };
}

describe("refreshProvider (pricing → models fallback)", () => {
  it("uses /api/pricing first when it returns models", async () => {
    const p = makeProvider();
    await repo.upsert(p);
    const r = await refreshProvider(p);
    expect(r.last_status).toBe("ok");
    expect(r.models).toEqual(["p-a", "p-b"]); // from pricing, sorted
    expect(pricingHits).toBeGreaterThan(0);
  });

  it("falls back to /v1/models when pricing 404s", async () => {
    pricing = "404";
    const p = makeProvider();
    await repo.upsert(p);
    const r = await refreshProvider(p);
    expect(r.last_status).toBe("ok");
    expect(r.models).toEqual(["m-a", "m-b"]); // from /v1/models
  });

  it("works WITHOUT a key when pricing is public", async () => {
    pricing = "ok";
    const p = makeProvider(false); // no key
    await repo.upsert(p);
    const r = await refreshProvider(p);
    expect(r.last_status).toBe("ok");
    expect(r.models).toEqual(["p-a", "p-b"]);
  });

  it("errors and preserves cache when both sources fail", async () => {
    // seed a good cache first
    pricing = "ok";
    const p = makeProvider();
    await repo.upsert(p);
    const ok = await refreshProvider(p);
    expect(ok.models).toEqual(["p-a", "p-b"]);

    // now both endpoints fail
    pricing = "404";
    models = "401";
    const err = await refreshProvider(ok);
    expect(err.last_status).toBe("error");
    expect(err.models).toEqual(["p-a", "p-b"]); // cache preserved
  });

  it("retries pricing on 5xx then succeeds", async () => {
    pricing = "500-then-ok";
    const p = makeProvider();
    await repo.upsert(p);
    const r = await refreshProvider(p);
    expect(r.last_status).toBe("ok");
    expect(pricingHits).toBeGreaterThanOrEqual(2);
  });

  it("falls back to {base}/models when pricing and /v1/models fail", async () => {
    // e.g. Zhipu v4 / Gemini openai-compat: no pricing, no /v1/models,
    // but the OpenAI listing lives at {base}/models.
    pricing = "404";
    models = "401";
    modelsRoot = "ok";
    const p = makeProvider();
    await repo.upsert(p);
    const r = await refreshProvider(p);
    expect(r.last_status).toBe("ok");
    expect(r.models).toEqual(["r-a", "r-b"]); // from {base}/models, sorted
  });

  it("treats a 200 non-JSON body as a failed attempt (falls through)", async () => {
    // pricing returns HTML (200) → not-JSON error; falls to /v1/models which works.
    pricing = "html";
    models = "ok";
    const p = makeProvider();
    await repo.upsert(p);
    const r = await refreshProvider(p);
    expect(r.last_status).toBe("ok");
    expect(r.models).toEqual(["m-a", "m-b"]); // from /v1/models
  });
});
