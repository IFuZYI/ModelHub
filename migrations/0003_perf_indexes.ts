import type { Migration } from "./0001_init";

/**
 * Performance indexes for the hot read paths (no schema/shape change):
 *  - user_providers.user_id: console list + per-user public page filter by owner.
 *  - users.role: homepage/stats look up the admin account(s) by role.
 * Both are plain secondary indexes; safe and idempotent (ifNotExists).
 */
export const migration0003PerfIndexes: Migration = {
  version: 3,
  async up(db) {
    await db.schema
      .createIndex("user_providers_user_id_idx")
      .ifNotExists()
      .on("user_providers")
      .column("user_id")
      .execute();

    await db.schema
      .createIndex("users_role_idx")
      .ifNotExists()
      .on("users")
      .column("role")
      .execute();
  },
};
