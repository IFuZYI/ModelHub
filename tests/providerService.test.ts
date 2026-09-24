import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";

process.env.MODELHUB_MASTER_KEY =
  process.env.MODELHUB_MASTER_KEY || Buffer.alloc(32, 4).toString("base64");
process.env.MODELHUB_FETCH_RETRIES = "0";
process.env.MODELHUB_FETCH_TIMEOUT_MS = "2000";

const { ProviderService } = await import("@/lib/services/providerService");
import type { ProviderRepository } from "@/lib/infra/repository";
import type { DataFile } from "@/lib/domain/provider";

// Local upstream: serves /api/pricing (primary) and /v1/models (fallback).
let server: http.Server;
let base = "";
beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url?.endsWith("/api/pricing")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({ data: [{ model_name: "m2" }, { model_name: "m1" }] })
      );
    }
    if (req.url?.endsWith("/v1/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data: [{ id: "m2" }, { id: "m1" }] }));
    }
    res.writeHead(404);
    res.end("x");
  });
  await new Promise<void>((r) =>
    server.listen(0, "127.0.0.1", () => {
      // base_url WITHOUT /v1 — the adapter builds both endpoints from it.
      base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      r();
    })
  );
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

// In-memory repository — the seam that makes services storage-agnostic.
function memoryRepo(): ProviderRepository {
  let data: DataFile = {
    settings: { refresh_interval_hours: 6 },
    providers: [],
  };
  return {
    async read() {
      return data;
    },
    async get(id) {
      return data.providers.find((p) => p.id === id);
    },
    async mutate(fn) {
      const r = await fn(data);
      data = r.data;
      return r.result;
    },
    async upsert(p) {
      const i = data.providers.findIndex((x) => x.id === p.id);
      if (i >= 0) data.providers[i] = p;
      else data.providers.push(p);
    },
    async remove(id) {
      const before = data.providers.length;
      data.providers = data.providers.filter((p) => p.id !== id);
      return data.providers.length !== before;
    },
  };
}

describe("ProviderService", () => {
  function svc() {
    return new ProviderService(memoryRepo());
  }

  it("creates a provider, encrypts key, fetches models", async () => {
    const view = await svc().create({
      name: "T",
      type: "newapi",
      base_url: base,
      key: "sk-1",
    });
    expect(view.model_count).toBe(2);
    expect(view.models).toEqual(["m1", "m2"]); // sorted
    // view never carries key material
    expect(JSON.stringify(view)).not.toContain("sk-1");
    expect(JSON.stringify(view)).not.toContain("key_enc");
  });

  it("lists and gets by id", async () => {
    const s = svc();
    const created = await s.create({
      name: "T",
      type: "native",
      base_url: base,
      key: "sk-1",
    });
    expect(await s.list()).toHaveLength(1);
    expect((await s.getView(created.id)).name).toBe("T");
  });

  it("update keeps key when not provided, clears aff on empty", async () => {
    const s = svc();
    const created = await s.create({
      name: "T",
      type: "newapi",
      base_url: base,
      aff_code: "INV1",
      key: "sk-1",
    });
    expect(created.aff_code).toBe("INV1");
    const updated = await s.update(created.id, { aff_code: "" });
    expect(updated.aff_code).toBeNull();
  });

  it("creates a provider WITHOUT a key (public pricing)", async () => {
    const view = await svc().create({
      name: "NoKey",
      type: "newapi",
      base_url: base,
    });
    expect(view.has_key).toBe(false);
    expect(view.model_count).toBe(2);
    expect(view.models).toEqual(["m1", "m2"]);
  });

  it("throws NOT_FOUND for missing id", async () => {
    await expect(svc().getView("nope")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("seeds a preset with built-in models and refreshes from upstream", async () => {
    const view = await svc().create({
      name: "Seeded",
      type: "native",
      base_url: base,
      models: ["seed-b", "seed-a"],
    });
    // base serves /api/pricing → live models replace the seed
    expect(view.models).toEqual(["m1", "m2"]);
    expect(view.manual_models).toBe(false);
  });

  it("keeps built-in models for manual providers (no upstream fetch)", async () => {
    const view = await svc().create({
      name: "Gemini-like",
      type: "native",
      // an origin with no /api/pricing or /v1/models — would fail a real fetch
      base_url: "https://example.invalid",
      models: ["gemini-2.5-pro", "gemini-2.5-flash"],
      manual_models: true,
    });
    expect(view.manual_models).toBe(true);
    expect(view.models).toEqual(["gemini-2.5-flash", "gemini-2.5-pro"]); // sorted seed
    expect(view.last_status).toBe("ok");
  });

  it("lets an update add manual models to a custom provider", async () => {
    const s = svc();
    const created = await s.create({
      name: "Custom",
      type: "custom",
      base_url: base, // local mock resolves fast
    });
    const updated = await s.update(created.id, {
      models: ["m-z", "m-a"],
      manual_models: true,
    });
    expect(updated.manual_models).toBe(true);
    expect(updated.models).toEqual(["m-a", "m-z"]); // sorted, kept as-is
    expect(updated.last_status).toBe("ok");
  });
});
