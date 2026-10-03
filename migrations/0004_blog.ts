import type { Migration } from "./0001_init";
import { sql } from "kysely";

/**
 * Blog-style extensions (v0.4): user profiles, tags, ratings, comments.
 *
 *   - user_profiles  — per-user public identity (display name, bio, avatar)
 *                      shown on the personal page, like a blog author bio.
 *   - tags           — a global tag vocabulary (Hugo-style taxonomy). Each tag
 *                      has a slug (stable, URL-safe) and a display name.
 *   - provider_tags  — many-to-many between user_providers and tags: the
 *                      "categories/tags" of a provider entry.
 *   - ratings        — one 0..5 star rating per (user, provider), upsertable.
 *   - comments       — threaded-less comments on a provider by registered users.
 *
 * All tables are additive; nothing existing is altered.
 */
export const migration0004Blog: Migration = {
  version: 4,
  async up(db) {
    await db.schema
      .createTable("user_profiles")
      .ifNotExists()
      .addColumn("user_id", "text", (col) =>
        col.primaryKey().references("users.id").onDelete("cascade")
      )
      .addColumn("display_name", "text")
      .addColumn("bio", "text")
      .addColumn("avatar", "text")
      .addColumn("updated_at", "text", (col) => col.notNull())
      .execute();

    await db.schema
      .createTable("tags")
      .ifNotExists()
      .addColumn("id", "text", (col) => col.primaryKey())
      .addColumn("slug", "text", (col) => col.notNull().unique())
      .addColumn("name", "text", (col) => col.notNull())
      .addColumn("created_at", "text", (col) => col.notNull())
      .execute();

    await db.schema
      .createTable("provider_tags")
      .ifNotExists()
      .addColumn("user_provider_id", "text", (col) =>
        col.notNull().references("user_providers.id").onDelete("cascade")
      )
      .addColumn("tag_id", "text", (col) =>
        col.notNull().references("tags.id").onDelete("cascade")
      )
      .addPrimaryKeyConstraint("provider_tags_pk", ["user_provider_id", "tag_id"])
      .execute();

    await db.schema
      .createIndex("provider_tags_tag_idx")
      .ifNotExists()
      .on("provider_tags")
      .column("tag_id")
      .execute();

    await db.schema
      .createTable("ratings")
      .ifNotExists()
      .addColumn("id", "text", (col) => col.primaryKey())
      .addColumn("user_provider_id", "text", (col) =>
        col.notNull().references("user_providers.id").onDelete("cascade")
      )
      .addColumn("user_id", "text", (col) =>
        col.notNull().references("users.id").onDelete("cascade")
      )
      .addColumn("score", "integer", (col) => col.notNull())
      .addColumn("created_at", "text", (col) => col.notNull())
      .addColumn("updated_at", "text", (col) => col.notNull())
      .addCheckConstraint(
        "ratings_score_range",
        sql`score >= 0 AND score <= 5`
      )
      .addUniqueConstraint("ratings_provider_user_unique", [
        "user_provider_id",
        "user_id",
      ])
      .execute();

    await db.schema
      .createTable("comments")
      .ifNotExists()
      .addColumn("id", "text", (col) => col.primaryKey())
      .addColumn("user_provider_id", "text", (col) =>
        col.notNull().references("user_providers.id").onDelete("cascade")
      )
      .addColumn("user_id", "text", (col) =>
        col.notNull().references("users.id").onDelete("cascade")
      )
      .addColumn("body", "text", (col) => col.notNull())
      .addColumn("created_at", "text", (col) => col.notNull())
      .addColumn("updated_at", "text", (col) => col.notNull())
      .execute();

    await db.schema
      .createIndex("comments_provider_idx")
      .ifNotExists()
      .on("comments")
      .columns(["user_provider_id", "created_at"])
      .execute();
  },
};
