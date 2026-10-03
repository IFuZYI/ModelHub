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
 * The upgrade matrix: a database frozen at ANY earlier version must reach the
 * latest schema with data intact and every new table usable. Each entry names
 * the version the DB is frozen at, and the versions the migrator must then run.
 */
const matrix: Array<{ frozenAt: number; expectRan: number[] }> = [
  { frozenAt: 0, expectRan: [1, 2, 3, 4, 5] },
  { frozenAt: 1, expectRan: [2, 3, 4, 5] },
  { frozenAt: 2, expectRan: [3, 4, 5] },
  { frozenAt: 3, expectRan: [4, 5] },
  { frozenAt: 4, expectRan: [5] },
];

async function freezeAt(db: AppDatabase, version: number): Promise<void> {
  const now = new Date().toISOString();
  for (const m of migrations.filter((m) => m.version <= version)) {
    await m.up(db);
    await db
      .insertInto("schema_migrations")
      .values({ version: m.version, applied_at: now })
      .execute();
  }
}

describe("upgrade matrix: every starting version reaches the latest", () => {
  for (const { frozenAt, expectRan } of matrix) {
    it(`v${frozenAt} → latest applies exactly [${expectRan.join(", ")}] and keeps data`, async () => {
      const db = memoryDb();
      const now = new Date().toISOString();

      // Phase 1 — freeze the DB at the earlier version.
      await freezeAt(db, frozenAt);

      // Phase 2 — seed a user that must survive the upgrade.
      // (Skipped when the DB is empty: users table does not exist at v0.)
      if (frozenAt >= 1) {
        await db
          .insertInto("users")
          .values({
            id: "u-up",
            username: "upgrade_user",
            email: null,
            password_hash: "h",
            role: "admin",
            status: "active",
            token_version: 0,
            slug: "upgradeslug1",
            created_at: now,
            updated_at: now,
          })
          .execute();
      }

      // Phase 3 — upgrade to the latest.
      const ran = await migrateDatabase(db);
      expect(ran).toEqual(expectRan);

      // Phase 4 — the seed survived, and the latest tables are usable.
      if (frozenAt >= 1) {
        const user = await db
          .selectFrom("users")
          .selectAll()
          .where("id", "=", "u-up")
          .executeTakeFirstOrThrow();
        expect(user.username).toBe("upgrade_user");
      }

      // invite_codes (v5) must be writable after every upgrade path.
      await db
        .insertInto("invite_codes")
        .values({
          id: "ic-up",
          code: "up-code",
          normalized_base_url: "https://up.example.com",
          note: null,
          created_at: now,
        })
        .execute();
      const code = await db
        .selectFrom("invite_codes")
        .selectAll()
        .executeTakeFirstOrThrow();
      expect(code.code).toBe("up-code");

      // Idempotent: a second run applies nothing.
      expect(await migrateDatabase(db)).toEqual([]);
    });
  }
});
