import { afterEach, describe, expect, it } from "vitest";
import {
  createDatabase,
  destroyDatabase,
  type AppDatabase,
} from "@/lib/infra/db";
import { migrateDatabase } from "@/lib/infra/migrate";

const databases: AppDatabase[] = [];
afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => destroyDatabase(db)));
});

function memoryDb(): AppDatabase {
  const db = createDatabase({ driver: "sqlite", sqlitePath: ":memory:" });
  databases.push(db);
  return db;
}

describe("migrateDatabase", () => {
  it("creates the v0.3 relational foundation on SQLite", async () => {
    const db = memoryDb();

    expect(await migrateDatabase(db)).toEqual([1, 2]);

    const tables = await db.introspection.getTables();
    expect(tables.map((table) => table.name).sort()).toEqual(
      [
        "email_verifications",
        "key_pool",
        "model_caches",
        "provider_stats",
        "schema_migrations",
        "settings",
        "user_providers",
        "users",
      ].sort()
    );

    const applied = await db
      .selectFrom("schema_migrations")
      .select("version")
      .orderBy("version")
      .execute();
    expect(applied).toEqual([{ version: 1 }, { version: 2 }]);
  });

  it("is idempotent after the migration ledger is written", async () => {
    const db = memoryDb();

    await migrateDatabase(db);
    expect(await migrateDatabase(db)).toEqual([]);
  });

  it("enforces one provider URL per user while allowing different users", async () => {
    const db = memoryDb();
    await migrateDatabase(db);
    const now = new Date().toISOString();
    await db
      .insertInto("users")
      .values([
        {
          id: "u-1",
          username: "one",
          email: null,
          password_hash: "hash",
          role: "user",
          status: "active",
          token_version: 0,
          slug: null,
          created_at: now,
          updated_at: now,
        },
        {
          id: "u-2",
          username: "two",
          email: null,
          password_hash: "hash",
          role: "user",
          status: "active",
          token_version: 0,
          slug: null,
          created_at: now,
          updated_at: now,
        },
      ])
      .execute();

    const provider = {
      name: "Example",
      description: null,
      type: "newapi" as const,
      base_url: "https://example.test",
      normalized_base_url: "https://example.test",
      free_tier: "none" as const,
      icon: null,
      adapter: "openai-compatible",
      aff_code: null,
      catalog_slugs: null,
      key_enc: null,
      manual_models: 0,
      register_methods: null,
    };
    await db
      .insertInto("user_providers")
      .values({ id: "p-1", user_id: "u-1", ...provider })
      .execute();
    await db
      .insertInto("user_providers")
      .values({ id: "p-2", user_id: "u-2", ...provider })
      .execute();

    await expect(
      db
        .insertInto("user_providers")
        .values({ id: "p-3", user_id: "u-1", ...provider })
        .execute()
    ).rejects.toThrow();
  });
});
