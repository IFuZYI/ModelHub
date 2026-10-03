import type { Kysely } from "kysely";
import { randomUUID } from "crypto";
import type { DatabaseSchema } from "../db";
import type { CommentView } from "../../domain/blog";

/**
 * Comments on providers, written by registered users. Flat (no threading),
 * newest first. Authors are resolved via join so the view carries usernames.
 */
export class CommentRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async insert(
    providerId: string,
    userId: string,
    body: string
  ): Promise<CommentView> {
    const now = new Date().toISOString();
    const row = {
      id: randomUUID(),
      user_provider_id: providerId,
      user_id: userId,
      body,
      created_at: now,
      updated_at: now,
    };
    await this.db.insertInto("comments").values(row).execute();
    return {
      id: row.id,
      body: row.body,
      created_at: row.created_at,
      updated_at: row.updated_at,
      user_id: userId,
      username: "",
    };
  }

  /** Comments for a provider, newest first, with author usernames. */
  async listForProvider(
    providerId: string,
    limit = 200
  ): Promise<CommentView[]> {
    const rows = await this.db
      .selectFrom("comments")
      .innerJoin("users", "users.id", "comments.user_id")
      .select([
        "comments.id",
        "comments.body",
        "comments.created_at",
        "comments.updated_at",
        "comments.user_id",
        "users.username",
      ])
      .where("comments.user_provider_id", "=", providerId)
      .orderBy("comments.created_at", "desc")
      .limit(limit)
      .execute();
    return rows.map((r) => ({
      id: r.id,
      body: r.body,
      created_at: r.created_at,
      updated_at: r.updated_at,
      user_id: r.user_id,
      username: r.username,
    }));
  }

  /** Comment counts for many providers (bulk, for card badges). */
  async countsFor(providerIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (providerIds.length === 0) return out;
    const rows = await this.db
      .selectFrom("comments")
      .select((eb) => [
        "user_provider_id",
        eb.fn.count<number>("id").as("n"),
      ])
      .where("user_provider_id", "in", providerIds)
      .groupBy("user_provider_id")
      .execute();
    for (const r of rows) out.set(r.user_provider_id, Number(r.n));
    return out;
  }

  /** Owner or the comment author may delete. Returns false when absent. */
  async remove(id: string): Promise<boolean> {
    const res = await this.db
      .deleteFrom("comments")
      .where("id", "=", id)
      .executeTakeFirst();
    return Number(res.numDeletedRows ?? 0) > 0;
  }

  async getById(id: string): Promise<
    | { id: string; user_id: string; user_provider_id: string }
    | undefined
  > {
    const row = await this.db
      .selectFrom("comments")
      .select(["id", "user_id", "user_provider_id"])
      .where("id", "=", id)
      .executeTakeFirst();
    return row;
  }
}
