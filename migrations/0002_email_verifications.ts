import type { Migration } from "./0001_init";

/**
 * Pending email verifications (ADR-0012). One row per issued code, carrying the
 * registration payload to apply once the code is confirmed. Rows are short-lived
 * and cleaned opportunistically by the verification service.
 */
export const migration0002EmailVerifications: Migration = {
  version: 2,
  async up(db) {
    await db.schema
      .createTable("email_verifications")
      .ifNotExists()
      .addColumn("id", "text", (col) => col.primaryKey())
      .addColumn("email", "text", (col) => col.notNull())
      .addColumn("code", "text", (col) => col.notNull())
      .addColumn("payload", "text", (col) => col.notNull())
      .addColumn("expires_at", "text", (col) => col.notNull())
      .addColumn("created_at", "text", (col) => col.notNull())
      .execute();

    await db.schema
      .createIndex("email_verifications_email_idx")
      .ifNotExists()
      .on("email_verifications")
      .column("email")
      .execute();
  },
};
