import { randomUUID } from "crypto";
import type { Kysely } from "kysely";
import type { DatabaseSchema } from "../db";

type Row = DatabaseSchema["invite_codes"];

/** A platform invite code scoped to one site (ADR-0015). */
export interface InviteCode {
  id: string;
  code: string;
  normalized_base_url: string;
  note: string | null;
  created_at: string;
}

function toInviteCode(row: Row): InviteCode {
  return {
    id: row.id,
    code: row.code,
    normalized_base_url: row.normalized_base_url,
    note: row.note,
    created_at: row.created_at,
  };
}

/**
 * The platform invite-code pool (ADR-0015). Codes are scoped per site because
 * a referral code only works on the relay that issued it.
 *
 * A code's source is not stored: the pool is the *union* of admin-entered rows
 * here and the aff codes users already carry on their own provider mounts. The
 * service layer merges the two so a code a user typed on their site is
 * immediately eligible for random draw without a second write.
 */
export class InviteCodeRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async listAll(): Promise<InviteCode[]> {
    const rows = await this.db
      .selectFrom("invite_codes")
      .selectAll()
      .orderBy("created_at", "desc")
      .execute();
    return rows.map(toInviteCode);
  }

  /** Codes registered for one site. */
  async listForUrl(normalizedBaseUrl: string): Promise<InviteCode[]> {
    const rows = await this.db
      .selectFrom("invite_codes")
      .selectAll()
      .where("normalized_base_url", "=", normalizedBaseUrl)
      .execute();
    return rows.map(toInviteCode);
  }

  /** Every distinct site that has at least one admin-registered code. */
  async distinctUrls(): Promise<string[]> {
    const rows = await this.db
      .selectFrom("invite_codes")
      .select("normalized_base_url")
      .distinct()
      .execute();
    return rows.map((r) => r.normalized_base_url);
  }

  async countForUrl(normalizedBaseUrl: string): Promise<number> {
    const res = await this.db
      .selectFrom("invite_codes")
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .where("normalized_base_url", "=", normalizedBaseUrl)
      .executeTakeFirst();
    return Number(res?.n ?? 0);
  }

  /** Add a code for a site. Idempotent: re-adding the same code is a no-op. */
  async add(
    normalizedBaseUrl: string,
    code: string,
    note: string | null = null
  ): Promise<void> {
    const trimmed = code.trim();
    if (!trimmed) return;
    const existing = await this.db
      .selectFrom("invite_codes")
      .select("id")
      .where("normalized_base_url", "=", normalizedBaseUrl)
      .where("code", "=", trimmed)
      .executeTakeFirst();
    if (existing) return;
    await this.db
      .insertInto("invite_codes")
      .values({
        id: randomUUID(),
        code: trimmed,
        normalized_base_url: normalizedBaseUrl,
        note,
        created_at: new Date().toISOString(),
      })
      .execute();
  }

  async remove(id: string): Promise<boolean> {
    const res = await this.db
      .deleteFrom("invite_codes")
      .where("id", "=", id)
      .executeTakeFirst();
    return Number(res.numDeletedRows ?? 0) > 0;
  }
}
