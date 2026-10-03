import type { Kysely } from "kysely";
import type { DatabaseSchema } from "../db";
import type { UserProfile } from "../../domain/blog";

/**
 * Public author profiles (blog-style). One row per user; absence of a row
 * means the user has no profile yet (all fields default to null).
 */
export class UserProfileRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async get(userId: string): Promise<UserProfile | undefined> {
    const row = await this.db
      .selectFrom("user_profiles")
      .selectAll()
      .where("user_id", "=", userId)
      .executeTakeFirst();
    return row;
  }

  /** Bulk fetch profiles for many users (search/list view assembly). */
  async getMany(userIds: string[]): Promise<Map<string, UserProfile>> {
    const out = new Map<string, UserProfile>();
    if (userIds.length === 0) return out;
    const rows = await this.db
      .selectFrom("user_profiles")
      .selectAll()
      .where("user_id", "in", userIds)
      .execute();
    for (const row of rows) out.set(row.user_id, row);
    return out;
  }

  /**
   * Create or patch a profile; only provided fields are written.
   *
   * Atomic upsert (onConflict on the user_id PK): a check-then-insert would
   * race when the same user saves twice concurrently, failing on the PK.
   */
  async upsert(
    userId: string,
    patch: {
      display_name?: string | null;
      bio?: string | null;
      avatar?: string | null;
    }
  ): Promise<UserProfile> {
    const now = new Date().toISOString();
    const inserted = await this.db
      .insertInto("user_profiles")
      .values({
        user_id: userId,
        display_name: patch.display_name ?? null,
        bio: patch.bio ?? null,
        avatar: patch.avatar ?? null,
        updated_at: now,
      })
      .onConflict((oc) =>
        oc.column("user_id").doUpdateSet((eb) => ({
          // Only overwrite fields the caller actually provided; keep the
          // stored value otherwise (null patch = "leave unchanged").
          display_name:
            patch.display_name !== undefined
              ? patch.display_name
              : eb.ref("user_profiles.display_name"),
          bio:
            patch.bio !== undefined ? patch.bio : eb.ref("user_profiles.bio"),
          avatar:
            patch.avatar !== undefined
              ? patch.avatar
              : eb.ref("user_profiles.avatar"),
          updated_at: now,
        }))
      )
      .returningAll()
      .executeTakeFirstOrThrow();
    return inserted;
  }
}
