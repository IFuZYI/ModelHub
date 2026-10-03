import { afterEach, describe, expect, it } from "vitest";
import {
  createDatabase,
  destroyDatabase,
  type AppDatabase,
} from "@/lib/infra/db";
import { migrateDatabase } from "@/lib/infra/migrate";
import { UserRepository } from "@/lib/infra/repositories/userRepo";
import { UserProviderRepository } from "@/lib/infra/repositories/userProviderRepo";
import { StatsRepository } from "@/lib/infra/repositories/statsRepo";
import { StatsService } from "@/lib/services/statsService";

const dbs: AppDatabase[] = [];
afterEach(async () => {
  await Promise.all(dbs.splice(0).map((db) => destroyDatabase(db)));
});

async function freshDb(): Promise<AppDatabase> {
  const db = createDatabase({ driver: "sqlite", sqlitePath: ":memory:" });
  dbs.push(db);
  await migrateDatabase(db);
  return db;
}

function owned(id: string, owner: string, url: string) {
  return {
    id,
    user_id: owner,
    name: "Site",
    description: null,
    type: "newapi" as const,
    base_url: url,
    aff_code: null,
    adapter: "openai-compatible",
    free_tier: "none" as const,
    catalog_slugs: {},
    key_enc: null,
    manual_models: false,
    icon: null,
    register_methods: [],
    models: [],
    last_fetched: null,
    last_status: "pending" as const,
    last_error: null,
    updated_at: null,
  };
}

function wire(db: AppDatabase) {
  return {
    providers: new UserProviderRepository(db),
    stats: new StatsRepository(db),
    users: new UserRepository(db),
    svc: new StatsService(
      new UserProviderRepository(db),
      new UserRepository(db),
      new StatsRepository(db)
    ),
  };
}

/** Insert a real user (providers FK to users). */
async function seedUser(db: AppDatabase, id: string) {
  await new UserRepository(db).insert({
    id,
    username: `u_${id}`,
    email: null,
    password_hash: "x",
    role: "user",
  });
}

/**
 * A stale provider_stats row (its providers are all gone) is invisible to the
 * per-URL recompute path — nothing points at that URL any more. A full sweep
 * is the only way to heal rows left behind by deletes that predate the
 * recompute-on-delete fix.
 */
describe("StatsService.recomputeAll", () => {
  it("drops rows whose providers no longer exist and keeps live ones", async () => {
    const db = await freshDb();
    const { providers, stats, svc } = wire(db);
    await seedUser(db, "u-1");

    // A live site…
    await providers.upsert(owned("p-live", "u-1", "https://live.example.com"));
    await svc.recompute("https://live.example.com");
    // …and a stale row for a site nothing mounts any more.
    await stats.upsertDerived({
      normalized_base_url: "https://stale.example.com",
      base_url: "https://stale.example.com",
      name: "Ghost",
      icon: null,
      type: "newapi",
      free_tier: "none",
      type_votes: { newapi: 1 },
      free_tier_votes: { none: 1 },
      user_count: 1,
    });

    await svc.recomputeAll();

    expect(await stats.get("https://stale.example.com")).toBeUndefined();
    expect(await stats.get("https://live.example.com")).toBeTruthy();
  });

  it("is a no-op on a clean table", async () => {
    const db = await freshDb();
    const { providers, stats, svc } = wire(db);
    await seedUser(db, "u-1");
    await providers.upsert(owned("p-1", "u-1", "https://a.example.com"));
    await svc.recompute("https://a.example.com");

    await svc.recomputeAll();

    const all = await stats.list();
    expect(all).toHaveLength(1);
    expect(all[0].normalized_base_url).toBe("https://a.example.com");
  });
});
