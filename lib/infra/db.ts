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
  email_verifications: {
    id: string;
    email: string;
    code: string;
    /** Pending registration payload (JSON) applied on successful verification. */
    payload: string;
    expires_at: string;
    created_at: string;
  };
  user_profiles: {
    user_id: string;
    display_name: string | null;
    bio: string | null;
    avatar: string | null;
    updated_at: string;
  };
  tags: {
    id: string;
    slug: string;
    name: string;
    created_at: string;
  };
  provider_tags: {
    user_provider_id: string;
    tag_id: string;
  };
  ratings: {
    id: string;
    user_provider_id: string;
    user_id: string;
    score: number;
    created_at: string;
    updated_at: string;
  };
  comments: {
    id: string;
    user_provider_id: string;
    user_id: string;
    body: string;
    created_at: string;
    updated_at: string;
  };
  invite_codes: {
    id: string;
    code: string;
    normalized_base_url: string;
    note: string | null;
    created_at: string;
  };
}

export type AppDatabase = Kysely<DatabaseSchema>;

/**
 * True when a driver error is a unique-constraint violation (SQLite via
 * better-sqlite3 or Postgres). Used to convert insert races into retries.
 */
export function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string") {
    if (code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
      return true;
    }
    if (code === "23505") return true; // Postgres unique_violation
  }
  const message = (err as { message?: unknown }).message;
  return (
    typeof message === "string" &&
    /UNIQUE constraint failed|duplicate key value/i.test(message)
  );
}

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
  // Lower disk/CPU overhead for this read-heavy workload:
  //  - synchronous=NORMAL is durable under WAL and avoids an fsync per commit.
  //  - busy_timeout lets the periodic refresh and request reads share the DB
  //    without spurious SQLITE_BUSY errors.
  //  - a bounded negative cache_size caps the page cache at ~8 MB (footprint).
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("cache_size = -8000");
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
