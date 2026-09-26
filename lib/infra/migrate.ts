import type { AppDatabase } from "./db";
import { migration0001Init } from "../../migrations/0001_init";
import { migration0002EmailVerifications } from "../../migrations/0002_email_verifications";

/** All migrations in version order. */
export const migrations = [
  migration0001Init,
  migration0002EmailVerifications,
] as const;

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
