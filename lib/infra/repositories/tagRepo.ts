import { sql, type Kysely, type Transaction } from "kysely";
import { randomUUID } from "crypto";
import type { DatabaseSchema } from "../db";
import { tagSlug, type Tag, type TagWithCount } from "../../domain/blog";

type TagRow = DatabaseSchema["tags"];

/** A Kysely handle: either the main DB or a transaction on it. */
type Db = Kysely<DatabaseSchema> | Transaction<DatabaseSchema>;

function toTag(row: TagRow): Tag {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    created_at: row.created_at,
  };
}

/**
 * Serializes tag WRITES (replace/prune) within this process.
 *
 * SQLite uses a single connection, so its writes are already serial — but
 * Postgres does not, and two concurrent write transactions interleaving
 * "insert tag → attach link" can deadlock on the FK KEY SHARE locks taken
 * by the insert (probe: 23/30 runs) or let one transaction's NOT EXISTS
 * prune snapshot cascade away a link the other just attached (silent loss,
 * 30/30 runs). Tag writes are rare and tiny, so a process-wide async lock
 * is the simplest provably-correct fix; the deployment model is a single
 * process (ADR-0009), so in-process serialization is complete.
 *
 * The chain lives on globalThis: the bundler can emit this module more than
 * once per process (e.g. an instrumentation chunk and a route chunk), and a
 * module-local promise would then be two independent locks that no longer
 * serialize the scheduler's hygiene sweep against route writes.
 */
const g = globalThis as unknown as {
  __modelhubTagWriteChain?: Promise<unknown>;
};

function withTagWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const chain = (g.__modelhubTagWriteChain ??= Promise.resolve());
  const run = chain.then(fn);
  // Keep the chain alive regardless of individual outcomes.
  g.__modelhubTagWriteChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * Advisory-lock key for cross-process tag-write serialization (Postgres).
 * Two int4 halves spelling "ModelHub" — fixed forever; changing it would
 * split the lock domain across versions during a rolling deploy.
 */
const TAG_LOCK_KEY_1 = 0x4d6f6465; // "Mode"
const TAG_LOCK_KEY_2 = 0x6c487562; // "lHub"

/** True when the executor's dialect runs multiple connections (Postgres). */
function isMultiConnection(executor: Db): boolean {
  return executor.getExecutor().adapter.supportsMultipleConnections !== false;
}

/**
 * Serialize tag writes ACROSS PROCESSES with a Postgres transaction-scoped
 * advisory lock (released automatically at commit/rollback, even on crash).
 *
 * The in-process lock only covers one Node process; ADR-0009 anticipates
 * multi-instance Postgres deployments, where two processes would otherwise
 * still hit the speculative-insert deadlock and the NOT EXISTS silent link
 * loss (both reproduced across two processes without this). Always taken as
 * the first statement of the transaction, and every tag write takes the
 * same key, so there is no lock-ordering cycle. No-op on SQLite (its single
 * connection already serializes writes).
 */
async function acquireCrossProcessLock(executor: Db): Promise<void> {
  if (!isMultiConnection(executor)) return;
  await sql`select pg_advisory_xact_lock(${TAG_LOCK_KEY_1}, ${TAG_LOCK_KEY_2})`.execute(
    executor
  );
}

/**
 * Tag vocabulary + provider↔tag links (v0.4 taxonomy).
 *
 * Tags are global: the first user to enter a name creates the row; later
 * users attach to the same row (matched by slug, case-insensitive). Tag rows
 * are never orphaned for long: every tag write prunes unreferenced rows, and
 * the scheduler runs a hygiene sweep. All write paths serialize on
 * `withTagWriteLock` so concurrent writers cannot deadlock or silently
 * delete each other's fresh links.
 */
export class TagRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  /** Find a tag by its slug. */
  async getBySlug(slug: string): Promise<Tag | undefined> {
    const row = await this.db
      .selectFrom("tags")
      .selectAll()
      .where("slug", "=", slug)
      .executeTakeFirst();
    return row ? toTag(row) : undefined;
  }

  /**
   * Resolve names to tag rows, creating missing ones (idempotent per slug).
   * Returns tags in the same order as the input names, deduped by slug.
   *
   * Creation is race-safe: `onConflict(slug).doNothing()` means a concurrent
   * creator of the same tag wins without raising, and we then re-read the row.
   * `executor` lets callers run this inside their transaction (see
   * `replaceProviderTags`).
   */
  async resolveOrCreate(names: string[], executor: Db = this.db): Promise<Tag[]> {
    const out: Tag[] = [];
    const seen = new Set<string>();
    for (const raw of names) {
      const slug = tagSlug(raw);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      const existing = await executor
        .selectFrom("tags")
        .selectAll()
        .where("slug", "=", slug)
        .executeTakeFirst();
      if (existing) {
        out.push(toTag(existing));
        continue;
      }
      const row: TagRow = {
        id: randomUUID(),
        slug,
        name: raw.trim(),
        created_at: new Date().toISOString(),
      };
      const inserted = await executor
        .insertInto("tags")
        .values(row)
        .onConflict((oc) => oc.column("slug").doNothing())
        .returningAll()
        .executeTakeFirst();
      if (inserted) {
        out.push(toTag(inserted));
        continue;
      }
      // Lost the race: another request created this slug first — read it back.
      const winner = await executor
        .selectFrom("tags")
        .selectAll()
        .where("slug", "=", slug)
        .executeTakeFirst();
      if (winner) out.push(toTag(winner));
    }
    return out;
  }

  /** All tags with usage counts, most-used first (then by name). */
  async listWithCounts(): Promise<TagWithCount[]> {
    const rows = await this.db
      .selectFrom("tags")
      .leftJoin("provider_tags", "provider_tags.tag_id", "tags.id")
      .select((eb) => [
        "tags.id",
        "tags.slug",
        "tags.name",
        "tags.created_at",
        eb.fn.count<number>("provider_tags.user_provider_id").as("count"),
      ])
      .groupBy(["tags.id", "tags.slug", "tags.name", "tags.created_at"])
      .orderBy("count", "desc")
      .orderBy("tags.name", "asc")
      .execute();
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      created_at: r.created_at,
      count: Number(r.count),
    }));
  }

  /** Tag ids attached to a provider. */
  async tagsForProvider(providerId: string): Promise<Tag[]> {
    const rows = await this.db
      .selectFrom("provider_tags")
      .innerJoin("tags", "tags.id", "provider_tags.tag_id")
      .selectAll("tags")
      .where("provider_tags.user_provider_id", "=", providerId)
      .orderBy("tags.name", "asc")
      .execute();
    return rows.map(toTag);
  }

  /** Tags for many providers at once (bulk view assembly). */
  async tagsForProviders(providerIds: string[]): Promise<Map<string, Tag[]>> {
    const out = new Map<string, Tag[]>();
    if (providerIds.length === 0) return out;
    const rows = await this.db
      .selectFrom("provider_tags")
      .innerJoin("tags", "tags.id", "provider_tags.tag_id")
      .select([
        "provider_tags.user_provider_id",
        "tags.id",
        "tags.slug",
        "tags.name",
        "tags.created_at",
      ])
      .where("provider_tags.user_provider_id", "in", providerIds)
      .orderBy("tags.name", "asc")
      .execute();
    for (const r of rows) {
      const list = out.get(r.user_provider_id) ?? [];
      list.push(
        toTag({
          id: r.id,
          slug: r.slug,
          name: r.name,
          created_at: r.created_at,
        })
      );
      out.set(r.user_provider_id, list);
    }
    return out;
  }

  /**
   * Full tag-write flow in ONE transaction under both locks: resolve the
   * names (creating missing tags), replace the provider's links, then prune
   * unreferenced tags.
   *
   * Two layers of serialization make this safe under real concurrency:
   *  - `withTagWriteLock` serializes within this process (covers SQLite and
   *    single-process Postgres);
   *  - `acquireCrossProcessLock` takes a Postgres advisory lock as the first
   *    statement of the transaction (covers multi-process deployments).
   * Link rows are also inserted in a deterministic order (tag id) so the
   * row-lock order cannot form an AB/BA cycle.
   *
   * Returns the provider's resulting tags.
   */
  async replaceProviderTags(
    providerId: string,
    names: string[]
  ): Promise<Tag[]> {
    await withTagWriteLock(() =>
      this.db.transaction().execute(async (trx) => {
        await acquireCrossProcessLock(trx);
        const resolved = await this.resolveOrCreate(names, trx);
        await trx
          .deleteFrom("provider_tags")
          .where("user_provider_id", "=", providerId)
          .execute();
        const ids = [...new Set(resolved.map((t) => t.id))].sort();
        if (ids.length > 0) {
          await trx
            .insertInto("provider_tags")
            .values(ids.map((tag_id) => ({ user_provider_id: providerId, tag_id })))
            .onConflict((oc) => oc.columns(["user_provider_id", "tag_id"]).doNothing())
            .execute();
        }
        await this.pruneOrphans(trx);
      })
    );
    return this.tagsForProvider(providerId);
  }

  /**
   * Hygiene sweep: prune unreferenced tags under both write locks. Used by
   * the scheduler and provider deletion — every other tag write prunes
   * inline.
   */
  async pruneWithLock(): Promise<number> {
    return withTagWriteLock(() =>
      this.db.transaction().execute(async (trx) => {
        await acquireCrossProcessLock(trx);
        return this.pruneOrphans(trx);
      })
    );
  }

  /** Providers carrying a tag slug (public listing / search by tag). */
  async providerIdsForTagSlug(slug: string): Promise<string[]> {
    const rows = await this.db
      .selectFrom("provider_tags")
      .innerJoin("tags", "tags.id", "provider_tags.tag_id")
      .select("provider_tags.user_provider_id")
      .where("tags.slug", "=", slug)
      .execute();
    return rows.map((r) => r.user_provider_id);
  }

  /**
   * Delete tags that no provider references anymore. Returns deleted count.
   *
   * The deletion itself is a single atomic NOT EXISTS statement, but callers
   * MUST hold the tag write lock: under READ COMMITTED a concurrent
   * "insert tag + attach link" transaction can still deadlock with the EPQ
   * re-check or have its fresh link cascaded away by this DELETE's snapshot.
   * `replaceProviderTags` and `pruneWithLock` are the lock-holding entry
   * points; `pruneOrphans` is the lock-free inner statement for use inside
   * an already-locked transaction.
   */
  async pruneOrphans(executor: Db = this.db): Promise<number> {
    const res = await executor
      .deleteFrom("tags")
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom("provider_tags")
              .select("provider_tags.tag_id")
              .whereRef("provider_tags.tag_id", "=", "tags.id")
          )
        )
      )
      .executeTakeFirst();
    return Number(res.numDeletedRows ?? 0);
  }
}
