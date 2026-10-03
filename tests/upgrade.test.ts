import { afterEach, describe, expect, it } from "vitest";
import {
  createDatabase,
  destroyDatabase,
  type AppDatabase,
} from "@/lib/infra/db";
import { migrations, migrateDatabase } from "@/lib/infra/migrate";

const dbs: AppDatabase[] = [];
afterEach(async () => {
  await Promise.all(dbs.splice(0).map((db) => destroyDatabase(db)));
});

function memoryDb(): AppDatabase {
  const db = createDatabase({ driver: "sqlite", sqlitePath: ":memory:" });
  dbs.push(db);
  return db;
}

/**
 * Upgrading an existing v0.3 database (migrations 1-3 applied) must apply only
 * the new migration(s), preserve data, and make the new tables usable.
 */
describe("v0.3 → v0.4 upgrade path", () => {
  it("applies only new migrations and keeps existing data", async () => {
    const db = memoryDb();
    const now = new Date().toISOString();

    // Phase 1 — reproduce a v0.3 database (migrations 1-3 only).
    const v03 = migrations.filter((m) => m.version <= 3);
    for (const m of v03) {
      await m.up(db);
      await db
        .insertInto("schema_migrations")
        .values({ version: m.version, applied_at: now })
        .execute();
    }
    await db
      .insertInto("users")
      .values({
        id: "u-1",
        username: "olduser",
        email: null,
        password_hash: "h",
        role: "admin",
        status: "active",
        token_version: 0,
        slug: "oldslug12345",
        created_at: now,
        updated_at: now,
      })
      .execute();
    await db
      .insertInto("user_providers")
      .values({
        id: "p-1",
        user_id: "u-1",
        name: "Legacy Site",
        description: null,
        type: "newapi",
        base_url: "https://legacy.example.com",
        normalized_base_url: "https://legacy.example.com",
        free_tier: "none",
        icon: null,
        adapter: "openai-compatible",
        aff_code: null,
        catalog_slugs: null,
        key_enc: null,
        manual_models: 0,
        register_methods: null,
      })
      .execute();

    // Phase 2 — the full migrator runs; only the new version is applied.
    const ran = await migrateDatabase(db);
    expect(ran).toEqual([4]);

    // Existing data intact.
    const user = await db
      .selectFrom("users")
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(user.username).toBe("olduser");
    const provider = await db
      .selectFrom("user_providers")
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(provider.name).toBe("Legacy Site");

    // New tables usable against the legacy provider.
    await db
      .insertInto("ratings")
      .values({
        id: "r-1",
        user_provider_id: "p-1",
        user_id: "u-1",
        score: 5,
        created_at: now,
        updated_at: now,
      })
      .execute();
    const rating = await db
      .selectFrom("ratings")
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(rating.score).toBe(5);

    // Idempotent on the next run.
    expect(await migrateDatabase(db)).toEqual([]);
  });
});
