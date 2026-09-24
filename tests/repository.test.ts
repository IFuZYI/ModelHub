import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "modelhub-store-"));
process.env.MODELHUB_DATA_PATH = path.join(dir, "data.json");
process.env.MODELHUB_MASTER_KEY =
  process.env.MODELHUB_MASTER_KEY || Buffer.alloc(32, 5).toString("base64");

const { fileRepository: repo } = await import("@/lib/infra/repository");

// Split storage lives alongside the configured data.json (same directory).
const DATA_DIR = path.dirname(process.env.MODELHUB_DATA_PATH!);
async function clearStore() {
  await Promise.all(
    [
      process.env.MODELHUB_DATA_PATH!,
      path.join(DATA_DIR, "providers.official.json"),
      path.join(DATA_DIR, "providers.other.json"),
      path.join(DATA_DIR, "settings.json"),
    ].map((f) => fs.rm(f, { force: true }))
  );
  await fs.rm(path.join(DATA_DIR, "models"), { recursive: true, force: true });
}

const sample = (id: string) => ({
  id,
  name: "p" + id,
  type: "newapi" as const,
  base_url: "https://x.com/v1",
  aff_code: null,
  adapter: "openai-compatible",
  key_enc: { v: 1 as const, iv: "i", ct: "c", tag: "t" },
  manual_models: false,
  icon: null,
  register_methods: [],
  models: [],
  last_fetched: null,
  last_status: "pending" as const,
  last_error: null,
  updated_at: null,
});

describe("fileRepository", () => {
  beforeEach(async () => {
    await clearStore();
  });
  afterEach(async () => {
    await clearStore();
  });

  it("returns defaults when file missing", async () => {
    const d = await repo.read();
    expect(d.providers).toEqual([]);
    expect(d.settings.refresh_interval_hours).toBeGreaterThan(0);
  });

  it("upserts and reads back", async () => {
    await repo.upsert(sample("11111111-1111-1111-1111-111111111111"));
    const got = await repo.get("11111111-1111-1111-1111-111111111111");
    expect(got?.name).toBe("p11111111-1111-1111-1111-111111111111");
  });

  it("deletes", async () => {
    const id = "22222222-2222-2222-2222-222222222222";
    await repo.upsert(sample(id));
    expect(await repo.remove(id)).toBe(true);
    expect(await repo.remove(id)).toBe(false);
  });

  it("serializes concurrent writes without loss", async () => {
    const ids = Array.from(
      { length: 20 },
      (_, i) =>
        `00000000-0000-0000-0000-0000000000${String(i).padStart(2, "0")}`
    );
    await Promise.all(ids.map((id) => repo.upsert(sample(id))));
    const d = await repo.read();
    expect(d.providers).toHaveLength(20);
  });

  it("mutate applies atomically", async () => {
    await repo.mutate((data) => {
      data.settings.refresh_interval_hours = 12;
      return { data, result: null };
    });
    const d = await repo.read();
    expect(d.settings.refresh_interval_hours).toBe(12);
  });
});
