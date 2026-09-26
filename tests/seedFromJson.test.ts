import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import {
  createDatabase,
  destroyDatabase,
  type AppDatabase,
} from "@/lib/infra/db";
import { migrateDatabase } from "@/lib/infra/migrate";
import { seedFromJsonIfNeeded } from "@/lib/infra/seedFromJson";
import { UserRepository } from "@/lib/infra/repositories/userRepo";
import { UserProviderRepository } from "@/lib/infra/repositories/userProviderRepo";
import { StatsRepository } from "@/lib/infra/repositories/statsRepo";

process.env.MODELHUB_MASTER_KEY =
  process.env.MODELHUB_MASTER_KEY || Buffer.alloc(32, 5).toString("base64");
process.env.MODELHUB_ADMIN_PASSWORD =
  process.env.MODELHUB_ADMIN_PASSWORD || "admin-secret";

const dbs: AppDatabase[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dbs.splice(0).map((db) => destroyDatabase(db)));
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true }))
  );
});

async function scratchDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "modelhub-seed-"));
  dirs.push(dir);
  return dir;
}

async function writeSplitLayout(dir: string) {
  await fs.writeFile(
    path.join(dir, "providers.official.json"),
    JSON.stringify({
      providers: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          name: "OpenAI",
          type: "native",
          base_url: "https://api.openai.com/v1",
          free_tier: "none",
          adapter: "openai-compatible",
          icon: null,
          catalog_slugs: {},
          key_enc: null,
          manual_models: false,
          register_methods: [],
        },
      ],
    })
  );
  await fs.mkdir(path.join(dir, "models"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "models", "11111111-1111-1111-1111-111111111111.json"),
    JSON.stringify({
      provider_id: "11111111-1111-1111-1111-111111111111",
      models: ["gpt-4o", "o3"],
      count: 2,
      last_fetched: "2026-09-26T00:00:00.000Z",
      last_status: "ok",
      last_error: null,
      updated_at: "2026-09-26T00:00:00.000Z",
    })
  );
}

describe("seedFromJsonIfNeeded", () => {
  it("creates an admin, mounts legacy providers, and rebuilds stats", async () => {
    const dir = await scratchDir();
    await writeSplitLayout(dir);
    process.env.MODELHUB_DATA_PATH = dir;

    const db = createDatabase({ driver: "sqlite", sqlitePath: ":memory:" });
    dbs.push(db);
    await migrateDatabase(db);

    const result = await seedFromJsonIfNeeded(db);
    expect(result).toEqual({ ran: true, users: 1, providers: 1 });

    const admin = await new UserRepository(db).getByUsername("admin");
    expect(admin?.role).toBe("admin");

    const owned = await new UserProviderRepository(db).listByUser(admin!.id);
    expect(owned).toHaveLength(1);
    expect(owned[0].name).toBe("OpenAI");
    expect(owned[0].models).toEqual(["gpt-4o", "o3"]);

    const stat = await new StatsRepository(db).get("https://api.openai.com");
    expect(stat?.name).toBe("OpenAI");
    expect(stat?.user_count).toBe(1);

    // Legacy file renamed aside so a re-run is a no-op.
    const remaining = await fs
      .readFile(path.join(dir, "providers.official.json"), "utf8")
      .then(() => true)
      .catch(() => false);
    expect(remaining).toBe(false);
  });

  it("is a no-op when users already exist", async () => {
    const dir = await scratchDir();
    await writeSplitLayout(dir);
    process.env.MODELHUB_DATA_PATH = dir;

    const db = createDatabase({ driver: "sqlite", sqlitePath: ":memory:" });
    dbs.push(db);
    await migrateDatabase(db);
    await new UserRepository(db).insert({
      id: "u-x",
      username: "existing",
      email: null,
      password_hash: "x",
      role: "admin",
    });

    const result = await seedFromJsonIfNeeded(db);
    expect(result.ran).toBe(false);
  });
});
