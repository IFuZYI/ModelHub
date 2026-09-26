import type { AppDatabase } from "../lib/infra/db";

/** A monotonically-versioned, idempotent schema migration. */
export interface Migration {
  version: number;
  up(db: AppDatabase): Promise<void>;
}

/** v0.3 relational foundation; portable across SQLite and Postgres. */
export const migration0001Init: Migration = {
  version: 1,
  async up(db) {
    await db.schema
      .createTable("schema_migrations")
      .ifNotExists()
      .addColumn("version", "integer", (col) => col.primaryKey())
      .addColumn("applied_at", "text", (col) => col.notNull())
      .execute();

    await db.schema
      .createTable("users")
      .ifNotExists()
      .addColumn("id", "text", (col) => col.primaryKey())
      .addColumn("username", "text", (col) => col.notNull().unique())
      .addColumn("email", "text", (col) => col.unique())
      .addColumn("password_hash", "text", (col) => col.notNull())
      .addColumn("role", "text", (col) => col.notNull())
      .addColumn("status", "text", (col) => col.notNull())
      .addColumn("token_version", "integer", (col) => col.notNull().defaultTo(0))
      .addColumn("slug", "text", (col) => col.unique())
      .addColumn("created_at", "text", (col) => col.notNull())
      .addColumn("updated_at", "text", (col) => col.notNull())
      .execute();

    await db.schema
      .createTable("user_providers")
      .ifNotExists()
      .addColumn("id", "text", (col) => col.primaryKey())
      .addColumn("user_id", "text", (col) =>
        col.notNull().references("users.id").onDelete("cascade")
      )
      .addColumn("name", "text", (col) => col.notNull())
      .addColumn("description", "text")
      .addColumn("type", "text", (col) => col.notNull())
      .addColumn("base_url", "text", (col) => col.notNull())
      .addColumn("normalized_base_url", "text", (col) => col.notNull())
      .addColumn("free_tier", "text", (col) => col.notNull())
      .addColumn("icon", "text")
      .addColumn("adapter", "text", (col) => col.notNull())
      .addColumn("aff_code", "text")
      .addColumn("catalog_slugs", "text")
      .addColumn("key_enc", "text")
      .addColumn("manual_models", "integer", (col) => col.notNull().defaultTo(0))
      .addColumn("register_methods", "text")
      .addUniqueConstraint("user_providers_user_url_unique", [
        "user_id",
        "normalized_base_url",
      ])
      .execute();

    await db.schema
      .createIndex("user_providers_normalized_base_url_idx")
      .ifNotExists()
      .on("user_providers")
      .column("normalized_base_url")
      .execute();

    await db.schema
      .createTable("model_caches")
      .ifNotExists()
      .addColumn("user_provider_id", "text", (col) =>
        col.primaryKey().references("user_providers.id").onDelete("cascade")
      )
      .addColumn("models", "text", (col) => col.notNull())
      .addColumn("count", "integer", (col) => col.notNull())
      .addColumn("last_fetched", "text")
      .addColumn("last_status", "text", (col) => col.notNull())
      .addColumn("last_error", "text")
      .addColumn("updated_at", "text")
      .execute();

    await db.schema
      .createTable("provider_stats")
      .ifNotExists()
      .addColumn("normalized_base_url", "text", (col) => col.primaryKey())
      .addColumn("base_url", "text", (col) => col.notNull())
      .addColumn("name", "text")
      .addColumn("icon", "text")
      .addColumn("type", "text")
      .addColumn("free_tier", "text")
      .addColumn("admin_name", "text")
      .addColumn("admin_icon", "text")
      .addColumn("admin_type", "text")
      .addColumn("admin_free_tier", "text")
      .addColumn("type_votes", "text")
      .addColumn("free_tier_votes", "text")
      .addColumn("user_count", "integer", (col) => col.notNull().defaultTo(0))
      .addColumn("updated_at", "text", (col) => col.notNull())
      .execute();

    await db.schema
      .createTable("key_pool")
      .ifNotExists()
      .addColumn("id", "text", (col) => col.primaryKey())
      .addColumn("normalized_base_url", "text", (col) => col.notNull())
      .addColumn("contributor_user_id", "text", (col) =>
        col.notNull().references("users.id").onDelete("cascade")
      )
      .addColumn("key_enc", "text", (col) => col.notNull())
      .addColumn("status", "text", (col) => col.notNull())
      .addColumn("fail_count", "integer", (col) => col.notNull().defaultTo(0))
      .addColumn("updated_at", "text", (col) => col.notNull())
      .addUniqueConstraint("key_pool_url_contributor_unique", [
        "normalized_base_url",
        "contributor_user_id",
      ])
      .execute();

    await db.schema
      .createIndex("key_pool_url_status_idx")
      .ifNotExists()
      .on("key_pool")
      .columns(["normalized_base_url", "status"])
      .execute();

    await db.schema
      .createTable("settings")
      .ifNotExists()
      .addColumn("key", "text", (col) => col.primaryKey())
      .addColumn("value", "text", (col) => col.notNull())
      .execute();
  },
};

export const migrations: readonly Migration[] = [migration0001Init];
