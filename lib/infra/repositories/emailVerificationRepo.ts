import { randomUUID } from "crypto";
import type { Kysely } from "kysely";
import type { DatabaseSchema } from "../db";

type Row = DatabaseSchema["email_verifications"];

export interface EmailVerification {
  id: string;
  email: string;
  code: string;
  payload: string;
  expires_at: string;
  created_at: string;
}

/** Pending email verification codes (ADR-0012). */
export class EmailVerificationRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  /** Create a code, dropping any prior pending codes for the same email. */
  async issue(
    email: string,
    code: string,
    payload: string,
    ttlMs: number
  ): Promise<EmailVerification> {
    await this.db
      .deleteFrom("email_verifications")
      .where("email", "=", email)
      .execute();
    const now = Date.now();
    const row: Row = {
      id: randomUUID(),
      email,
      code,
      payload,
      expires_at: new Date(now + ttlMs).toISOString(),
      created_at: new Date(now).toISOString(),
    };
    await this.db.insertInto("email_verifications").values(row).execute();
    return row;
  }

  /** Find a live (unexpired) code match for an email. */
  async findValid(
    email: string,
    code: string
  ): Promise<EmailVerification | undefined> {
    const row = await this.db
      .selectFrom("email_verifications")
      .selectAll()
      .where("email", "=", email)
      .where("code", "=", code)
      .executeTakeFirst();
    if (!row) return undefined;
    if (new Date(row.expires_at).getTime() <= Date.now()) return undefined;
    return row;
  }

  async consume(id: string): Promise<void> {
    await this.db
      .deleteFrom("email_verifications")
      .where("id", "=", id)
      .execute();
  }

  /** Opportunistic cleanup of expired rows. */
  async purgeExpired(): Promise<void> {
    await this.db
      .deleteFrom("email_verifications")
      .where("expires_at", "<=", new Date().toISOString())
      .execute();
  }
}
