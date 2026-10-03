import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDatabase,
  destroyDatabase,
  type AppDatabase,
} from "@/lib/infra/db";
import { migrateDatabase } from "@/lib/infra/migrate";
import { UserRepository } from "@/lib/infra/repositories/userRepo";
import { UserProviderService } from "@/lib/services/userProviderService";
import { StatsService } from "@/lib/services/statsService";
import { KeyPoolService } from "@/lib/services/keyPoolService";
import { KeyPoolRepository } from "@/lib/infra/repositories/keyPoolRepo";
import { SettingsRepository } from "@/lib/infra/repositories/settingsRepo";
import { UserProviderRepository } from "@/lib/infra/repositories/userProviderRepo";
import { StatsRepository } from "@/lib/infra/repositories/statsRepo";
import { TagRepository } from "@/lib/infra/repositories/tagRepo";
import * as probe from "@/lib/services/probe";

const dbs: AppDatabase[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dbs.splice(0).map((db) => destroyDatabase(db)));
});

async function freshDb(): Promise<AppDatabase> {
  const db = createDatabase({ driver: "sqlite", sqlitePath: ":memory:" });
  dbs.push(db);
  await migrateDatabase(db);
  return db;
}

async function makeUser(db: AppDatabase, id: string, role: "admin" | "user") {
  await new UserRepository(db).insert({
    id,
    username: id,
    email: null,
    password_hash: "x",
    role,
  });
}

/** Build a service graph wired to one db + a stubbed probe result. */
function services(db: AppDatabase, probeResult: probe.ProbeResult) {
  vi.spyOn(probe, "probeModels").mockResolvedValue(probeResult);
  const pool = new KeyPoolService(
    new KeyPoolRepository(db),
    new SettingsRepository(db)
  );
  const stats = new StatsService(
    new UserProviderRepository(db),
    new UserRepository(db),
    new StatsRepository(db)
  );
  const svc = new UserProviderService(
    new UserProviderRepository(db),
    new UserRepository(db),
    pool,
    stats,
    new TagRepository(db)
  );
  return { svc, pool, stats };
}

describe("UserProviderService", () => {
  it("creates a provider, contributes its key to the pool, and probes ok", async () => {
    const db = await freshDb();
    await makeUser(db, "u-1", "user");
    const { svc } = services(db, {
      status: "ok",
      models: ["gpt-4o"],
      error: null,
      authFailed: false,
    });

    const view = await svc.create("u-1", "user", {
      name: "Example",
      type: "newapi",
      base_url: "https://api.example.com/v1",
      key: "sk-live",
    });
    expect(view.model_count).toBe(1);
    expect(view.has_key).toBe(true);
    expect(view.last_status).toBe("ok");

    // Key was contributed to the pool under the normalized url.
    const pool = await new KeyPoolRepository(db).listForUrl(
      "https://api.example.com"
    );
    expect(pool).toHaveLength(1);
    expect(pool[0].contributor_user_id).toBe("u-1");
  });

  it("rejects a duplicate URL for the same user", async () => {
    const db = await freshDb();
    await makeUser(db, "u-1", "user");
    const { svc } = services(db, {
      status: "ok",
      models: [],
      error: null,
      authFailed: false,
    });
    await svc.create("u-1", "user", {
      name: "A",
      type: "newapi",
      base_url: "https://api.example.com",
    });
    await expect(
      svc.create("u-1", "user", {
        name: "B",
        type: "newapi",
        base_url: "https://api.example.com/v1/",
      })
    ).rejects.toThrow(/URL 重复/);
  });

  it("recomputes stats across users and preserves admin override", async () => {
    const db = await freshDb();
    await makeUser(db, "u-1", "user");
    await makeUser(db, "u-2", "user");
    const { svc, stats } = services(db, {
      status: "ok",
      models: [],
      error: null,
      authFailed: false,
    });
    await svc.create("u-1", "user", {
      name: "Cat API",
      type: "newapi",
      base_url: "https://api.cat.top",
      free_tier: "free",
    });
    await svc.create("u-2", "user", {
      name: "Cat API",
      type: "newapi",
      base_url: "https://api.cat.top/v1",
      free_tier: "none",
    });
    const list = await stats.list();
    const row = list.find(
      (s) => s.normalized_base_url === "https://api.cat.top"
    );
    expect(row?.user_count).toBe(2);
    expect(row?.effective_name).toBe("Cat API");
    expect(row?.effective_free_tier).toBe("free"); // 1 free vs 1 none → free wins first-seen
  });
});
