import type { Kysely } from "kysely";
import { randomUUID } from "crypto";
import type { DatabaseSchema } from "../db";
import { encrypt, type EncryptedValue } from "../crypto";

type PoolRow = DatabaseSchema["key_pool"];
export type PoolStatus = "valid" | "invalid" | "unverified";

export interface PoolKey {
  id: string;
  normalized_base_url: string;
  contributor_user_id: string;
  key_enc: EncryptedValue;
  status: PoolStatus;
  fail_count: number;
  updated_at: string;
}

function toPoolKey(row: PoolRow): PoolKey {
  return {
    id: row.id,
    normalized_base_url: row.normalized_base_url,
    contributor_user_id: row.contributor_user_id,
    key_enc: JSON.parse(row.key_enc) as EncryptedValue,
    status: row.status,
    fail_count: row.fail_count,
    updated_at: row.updated_at,
  };
}

/**
 * Shared key pool for model probing (ADR-0011). Keyed by normalized_base_url;
 * one row per (url, contributor). Keys are AES-256-GCM encrypted at rest and
 * only ever used to fetch model lists — never proxied to callers.
 */
export class KeyPoolRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  /** Add or replace a contributor's key for a url (auto-contribution). */
  async put(
    normalizedBaseUrl: string,
    contributorUserId: string,
    plainKey: string
  ): Promise<void> {
    const now = new Date().toISOString();
    const key_enc = JSON.stringify(encrypt(plainKey));
    const existing = await this.db
      .selectFrom("key_pool")
      .select("id")
      .where("normalized_base_url", "=", normalizedBaseUrl)
      .where("contributor_user_id", "=", contributorUserId)
      .executeTakeFirst();
    if (existing) {
      await this.db
        .updateTable("key_pool")
        .set({ key_enc, status: "unverified", fail_count: 0, updated_at: now })
        .where("id", "=", existing.id)
        .execute();
    } else {
      await this.db
        .insertInto("key_pool")
        .values({
          id: randomUUID(),
          normalized_base_url: normalizedBaseUrl,
          contributor_user_id: contributorUserId,
          key_enc,
          status: "unverified",
          fail_count: 0,
          updated_at: now,
        })
        .execute();
    }
  }

  /** All pool keys for a url (optionally only usable ones: valid|unverified). */
  async listForUrl(
    normalizedBaseUrl: string,
    usableOnly = false
  ): Promise<PoolKey[]> {
    let q = this.db
      .selectFrom("key_pool")
      .selectAll()
      .where("normalized_base_url", "=", normalizedBaseUrl);
    if (usableOnly) q = q.where("status", "!=", "invalid");
    const rows = await q.execute();
    return rows.map(toPoolKey);
  }

  /** Remove a specific contributor's key for a url (used by cleanup). */
  async removeById(id: string): Promise<void> {
    await this.db.deleteFrom("key_pool").where("id", "=", id).execute();
  }

  async removeForContributorUrl(
    normalizedBaseUrl: string,
    contributorUserId: string
  ): Promise<void> {
    await this.db
      .deleteFrom("key_pool")
      .where("normalized_base_url", "=", normalizedBaseUrl)
      .where("contributor_user_id", "=", contributorUserId)
      .execute();
  }

  async setStatus(id: string, status: PoolStatus): Promise<void> {
    await this.db
      .updateTable("key_pool")
      .set({ status, updated_at: new Date().toISOString() })
      .where("id", "=", id)
      .execute();
  }

  /**
   * Record a deterministic auth failure (401/403). Returns true and removes the
   * row once fail_count reaches `threshold` (ADR-0011: default 2).
   */
  async recordFailureAndMaybeDelete(id: string, threshold = 2): Promise<boolean> {
    const row = await this.db
      .selectFrom("key_pool")
      .select(["fail_count"])
      .where("id", "=", id)
      .executeTakeFirst();
    if (!row) return false;
    const next = row.fail_count + 1;
    if (next >= threshold) {
      await this.removeById(id);
      return true;
    }
    await this.db
      .updateTable("key_pool")
      .set({ fail_count: next, updated_at: new Date().toISOString() })
      .where("id", "=", id)
      .execute();
    return false;
  }

  /** Reset failure count after a successful probe. */
  async markValid(id: string): Promise<void> {
    await this.db
      .updateTable("key_pool")
      .set({ status: "valid", fail_count: 0, updated_at: new Date().toISOString() })
      .where("id", "=", id)
      .execute();
  }
}
