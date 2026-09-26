import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import path from "path";
import { Kysely, PostgresDialect, SqliteDialect } from "kysely";
import { Pool } from "pg";
import { config } from "../config/env";
import { AppError } from "../domain/errors";

/**
 * v0.3 relational schema. JSON columns intentionally remain strings so the
 * same types work on SQLite and Postgres; repositories own serialization.
 */
export interface DatabaseSchema {
  schema_migrations: {
    version: number;
    applied_at: string;
  };
  users: {
    id: string;
    username: string;
    email: string | null;
    password_hash: string;
    role: "admin" | "user";
    status: "active" | "disabled";
    token_version: number;
    slug: string | null;
    created_at: string;
    updated_at: string;
  };
  user_providers: {
    id: string;
    user_id: string;
    name: string;
    description: string | null;
    type: "native" | "proxy" | "newapi" | "custom";
    base_url: string;
    normalized_base_url: string;
    free_tier: "full" | "free" | "none";
    icon: string | null;
    adapter: string;
    aff_code: string | null;
    catalog_slugs: string | null;
    key_enc: string | null;
    manual_models: number;
    register_methods: string | null;
  };
  model_caches: {
    user_provider_id: string;
    models: string;
    count: number;
    last_fetched: string | null;
    last_status: "ok" | "error" | "pending" | "needs_key";
    last_error: string | null;
    updated_at: string | null;
  };
  provider_stats: {
    normalized_base_url: string;
    base_url: string;
    name: string | null;
    icon: string | null;
    type: "native" | "proxy" | "newapi" | "custom" | null;
    free_tier: "full" | "free" | "none" | null;
    admin_name: string | null;
    admin_icon: string | null;
    admin_type: "native" | "proxy" | "newapi" | "custom" | null;
    admin_free_tier: "full" | "free" | "none" | null;
    type_votes: string | null;
    free_tier_votes: string | null;
    user_count: number;
    updated_at: string;
  };
  key_pool: {
    id: string;
    normalized_base_url: string;
    contributor_user_id: string;
    key_enc: string;
    status: "valid" | "invalid" | "unverified";
    fail_count: number;
    updated_at: string;
  };
  settings: {
    key: string;
    value: string;
  };
}

export type AppDatabase = Kysely<DatabaseSchema>;

/** Resolve the default SQLite file without touching the filesystem. */
export function resolveSqlitePath(dataPath: string | null = config.dataPath): string {
  if (!dataPath) return path.join(process.cwd(), "data", "app.db");
  const resolved = path.resolve(dataPath);
  return resolved.toLowerCase().endsWith(".db")
    ? resolved
    : path.join(resolved, "app.db");
}

export interface DatabaseOptions {
  driver?: "sqlite" | "postgres";
  databaseUrl?: string | null;
  sqlitePath?: string;
}

/**
 * Construct an isolated DB handle. Callers own lifecycle and must call
 * destroyDatabase; tests use this instead of the lazily-created appDatabase.
 */
export function createDatabase(options: DatabaseOptions = {}): AppDatabase {
  const driver = options.driver ?? config.databaseDriver;
  if (driver === "postgres") {
    const connectionString = options.databaseUrl ?? config.databaseUrl;
    if (!connectionString) {
      throw AppError.config("DATABASE_URL is required when DATABASE_DRIVER=postgres");
    }
    return new Kysely<DatabaseSchema>({
      dialect: new PostgresDialect({ pool: new Pool({ connectionString }) }),
    });
  }

  const sqlitePath = options.sqlitePath ?? resolveSqlitePath();
  if (sqlitePath !== ":memory:") mkdirSync(path.dirname(sqlitePath), { recursive: true });
  const sqlite = new Database(sqlitePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return new Kysely<DatabaseSchema>({ dialect: new SqliteDialect({ database: sqlite }) });
}

/** Close a DB created by createDatabase, releasing SQLite/pg handles. */
export async function destroyDatabase(db: AppDatabase): Promise<void> {
  await db.destroy();
}

/** Lazily created app connection; avoids opening a DB when config is imported in tests. */
let singleton: AppDatabase | null = null;
export function getDatabase(): AppDatabase {
  singleton ??= createDatabase();
  return singleton;
}
