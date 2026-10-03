import type { Migration } from "./0001_init";

/**
 * Platform invite-code pool (ADR-0015).
 *
 * Besides the codes users already carry on their own provider mounts, an admin
 * can add codes to the platform pool directly (e.g. the operator's own referral
 * code, or codes collected before any user joined). A provider whose aff_code
 * is the RANDOM sentinel — or blank while the blank-policy setting is "random"
 * — draws one of these at render time.
 *
 * `normalized_base_url` scopes a code to the site it is valid on: an aff code
 * only works on its own relay, so the pool is always queried per site.
 * Additive migration; nothing existing is altered.
 */
export const migration0005InviteCodes: Migration = {
  version: 5,
  async up(db) {
    await db.schema
      .createTable("invite_codes")
      .ifNotExists()
      .addColumn("id", "text", (col) => col.primaryKey())
      .addColumn("code", "text", (col) => col.notNull())
      .addColumn("normalized_base_url", "text", (col) => col.notNull())
      .addColumn("note", "text")
      .addColumn("created_at", "text", (col) => col.notNull())
      .execute();

    // A code is unique per site (the same string may be valid on another site).
    await db.schema
      .createIndex("invite_codes_site_code_idx")
      .ifNotExists()
      .unique()
      .on("invite_codes")
      .columns(["normalized_base_url", "code"])
      .execute();

    // Pool lookups are always per site.
    await db.schema
      .createIndex("invite_codes_site_idx")
      .ifNotExists()
      .on("invite_codes")
      .column("normalized_base_url")
      .execute();
  },
};
