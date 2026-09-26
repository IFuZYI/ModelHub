import type { AppDatabase } from "./db";
import { migrations } from "../../migrations/0001_init";

/**
 * Apply unapplied schema migrations in version order. Each migration is
 * recorded only after its `up` succeeds, making startup retries safe.
 */
export async function migrateDatabase(db: AppDatabase): Promise<number[]> {
  // The migration ledger may not exist yet; the initial migration creates it.
  const ledgerExists = await db.introspection
    .getTables()
    .then((tables) => tables.some((table) => table.name === "schema_migrations"));
  const applied = ledgerExists
    ? new Set(
        (await db.selectFrom("schema_migrations").select("version").execute()).map(
          (row) => row.version
        )
      )
    : new Set<number>();

  const ran: number[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    await migration.up(db);
    await db
      .insertInto("schema_migrations")
      .values({ version: migration.version, applied_at: new Date().toISOString() })
      .execute();
    ran.push(migration.version);
  }
  return ran;
}
