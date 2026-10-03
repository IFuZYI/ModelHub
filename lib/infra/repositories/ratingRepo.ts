import type { Kysely } from "kysely";
import { randomUUID } from "crypto";
import type { DatabaseSchema } from "../db";
import {
  summarizeRatings,
  type RatingSummary,
  type RatingView,
} from "../../domain/blog";

/**
 * Star ratings: one row per (provider, user), upsertable. Aggregates are
 * computed on read (no denormalized columns) so they can never drift.
 */
export class RatingRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  /**
   * Insert or replace a user's rating for a provider.
   *
   * Atomic upsert: a check-then-insert would race when the same user submits
   * two ratings concurrently (both SELECT miss, both INSERT → UNIQUE 500).
   * `onConflict` makes the second write an UPDATE at the DB level.
   */
  async upsert(
    providerId: string,
    userId: string,
    score: number
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .insertInto("ratings")
      .values({
        id: randomUUID(),
        user_provider_id: providerId,
        user_id: userId,
        score,
        created_at: now,
        updated_at: now,
      })
      .onConflict((oc) =>
        oc
          .columns(["user_provider_id", "user_id"])
          .doUpdateSet({ score, updated_at: now })
      )
      .execute();
  }

  /** Remove a user's rating (idempotent). */
  async remove(providerId: string, userId: string): Promise<void> {
    await this.db
      .deleteFrom("ratings")
      .where("user_provider_id", "=", providerId)
      .where("user_id", "=", userId)
      .execute();
  }

  /** All raw scores for a provider (for summary computation). */
  async scoresFor(providerId: string): Promise<number[]> {
    const rows = await this.db
      .selectFrom("ratings")
      .select("score")
      .where("user_provider_id", "=", providerId)
      .execute();
    return rows.map((r) => r.score);
  }

  /** Summary for one provider. */
  async summaryFor(providerId: string): Promise<RatingSummary> {
    return summarizeRatings(await this.scoresFor(providerId));
  }

  /**
   * Summaries for many providers at once: returns providerId → summary.
   * One grouped query (score tallies) folded in JS, instead of N reads.
   *
   * Out-of-range scores are ignored for BOTH count and distribution so this
   * stays consistent with summarizeRatings (which folds the same way).
   */
  async summariesFor(providerIds: string[]): Promise<Map<string, RatingSummary>> {
    const out = new Map<string, RatingSummary>();
    if (providerIds.length === 0) return out;
    // Prefill every requested id so callers can rely on map.get(id) presence.
    for (const id of providerIds) {
      out.set(id, { average: null, count: 0, distribution: [0, 0, 0, 0, 0, 0] });
    }
    const rows = await this.db
      .selectFrom("ratings")
      .select((eb) => [
        "user_provider_id",
        "score",
        eb.fn.count<number>("id").as("n"),
      ])
      .where("user_provider_id", "in", providerIds)
      .groupBy(["user_provider_id", "score"])
      .execute();
    for (const r of rows) {
      if (r.score < 0 || r.score > 5) continue; // consistent with summarizeRatings
      const cur = out.get(r.user_provider_id) ?? {
        average: null,
        count: 0,
        distribution: [0, 0, 0, 0, 0, 0],
      };
      const n = Number(r.n);
      cur.distribution[r.score] += n;
      cur.count += n;
      out.set(r.user_provider_id, cur);
    }
    for (const [id, s] of out) {
      let total = 0;
      for (let i = 0; i <= 5; i++) total += i * s.distribution[i];
      s.average = s.count > 0 ? Math.round((total / s.count) * 10) / 10 : null;
      out.set(id, s);
    }
    return out;
  }

  /** A user's own score for a provider, or null. */
  async myScore(providerId: string, userId: string): Promise<number | null> {
    const row = await this.db
      .selectFrom("ratings")
      .select("score")
      .where("user_provider_id", "=", providerId)
      .where("user_id", "=", userId)
      .executeTakeFirst();
    return row?.score ?? null;
  }

  /** Ratings for a provider with author usernames (newest first). */
  async listForProvider(providerId: string): Promise<RatingView[]> {
    const rows = await this.db
      .selectFrom("ratings")
      .innerJoin("users", "users.id", "ratings.user_id")
      .select([
        "ratings.score",
        "ratings.user_id",
        "users.username",
        "ratings.updated_at",
      ])
      .where("ratings.user_provider_id", "=", providerId)
      .orderBy("ratings.updated_at", "desc")
      .execute();
    return rows.map((r) => ({
      score: r.score,
      user_id: r.user_id,
      username: r.username,
    }));
  }
}
