import { afterEach, describe, expect, it } from "vitest";
import {
  createDatabase,
  destroyDatabase,
  type AppDatabase,
} from "@/lib/infra/db";
import { migrateDatabase } from "@/lib/infra/migrate";
import { UserRepository } from "@/lib/infra/repositories/userRepo";
import { UserProviderRepository } from "@/lib/infra/repositories/userProviderRepo";
import { TagRepository } from "@/lib/infra/repositories/tagRepo";
import { RatingRepository } from "@/lib/infra/repositories/ratingRepo";
import { CommentRepository } from "@/lib/infra/repositories/commentRepo";
import { UserProfileRepository } from "@/lib/infra/repositories/userProfileRepo";
import { summarizeRatings, tagSlug, isValidTagName } from "@/lib/domain/blog";

const dbs: AppDatabase[] = [];
afterEach(async () => {
  await Promise.all(dbs.splice(0).map((db) => destroyDatabase(db)));
});

async function freshDb(): Promise<AppDatabase> {
  const db = createDatabase({ driver: "sqlite", sqlitePath: ":memory:" });
  dbs.push(db);
  await migrateDatabase(db);
  return db;
}

async function makeUser(db: AppDatabase, id: string, username = id) {
  await new UserRepository(db).insert({
    id,
    username,
    email: null,
    password_hash: "x",
    role: "user",
  });
}

async function makeProvider(db: AppDatabase, id: string, userId: string) {
  await new UserProviderRepository(db).upsert({
    id,
    user_id: userId,
    name: "Example",
    description: null,
    type: "newapi",
    base_url: `https://${id}.example.com`,
    aff_code: null,
    adapter: "openai-compatible",
    free_tier: "none",
    catalog_slugs: {},
    key_enc: null,
    manual_models: false,
    icon: null,
    register_methods: [],
    models: ["gpt-4o"],
    last_fetched: null,
    last_status: "pending",
    last_error: null,
    updated_at: null,
  });
}

describe("tag domain helpers", () => {
  it("normalizes names to stable slugs", () => {
    expect(tagSlug("OpenAI")).toBe("openai");
    expect(tagSlug("  Free Tier ")).toBe("free-tier");
    expect(tagSlug("中文标签")).toBe("中文标签");
    expect(tagSlug("a__b")).toBe("a-b");
    expect(tagSlug("!!!")).toBe("");
  });

  it("validates tag names", () => {
    expect(isValidTagName("openai")).toBe(true);
    expect(isValidTagName("   ")).toBe(false);
    expect(isValidTagName("!!!")).toBe(false);
    expect(isValidTagName("a".repeat(41))).toBe(false);
  });
});

describe("rating summaries", () => {
  it("folds scores into average + distribution", () => {
    const s = summarizeRatings([5, 4, 4, 0]);
    expect(s.count).toBe(4);
    expect(s.distribution).toEqual([1, 0, 0, 0, 2, 1]);
    expect(s.average).toBe(3.3); // 13/4 = 3.25 → 3.3
  });

  it("returns an empty summary for no scores", () => {
    const s = summarizeRatings([]);
    expect(s).toEqual({ average: null, count: 0, distribution: [0, 0, 0, 0, 0, 0] });
  });
});

describe("TagRepository", () => {
  it("creates tags once and resolves by slug", async () => {
    const db = await freshDb();
    const repo = new TagRepository(db);
    const first = await repo.resolveOrCreate(["OpenAI", "Free"]);
    const second = await repo.resolveOrCreate(["openai"]);
    expect(second[0].id).toBe(first[0].id);

    const withCounts = await repo.listWithCounts();
    expect(withCounts).toHaveLength(2);
    expect(withCounts.every((t) => t.count === 0)).toBe(true);
  });

  it("attaches tags to providers and prunes orphans", async () => {
    const db = await freshDb();
    await makeUser(db, "u-1");
    await makeProvider(db, "p-1", "u-1");
    const repo = new TagRepository(db);

    // replaceProviderTags resolves names, attaches, and prunes in one flow.
    const attached = await repo.replaceProviderTags("p-1", ["openai"]);
    expect(attached.map((t) => t.slug)).toEqual(["openai"]);

    const tags = await repo.tagsForProvider("p-1");
    expect(tags.map((t) => t.slug)).toEqual(["openai"]);

    // Detach then prune.
    await repo.replaceProviderTags("p-1", []);
    expect(await repo.getBySlug("openai")).toBeUndefined();
  });

  it("is race-safe when two writers create the same tag concurrently", async () => {
    const db = await freshDb();
    await makeUser(db, "u-1");
    await makeUser(db, "u-2");
    await makeProvider(db, "p-1", "u-1");
    await makeProvider(db, "p-2", "u-2");
    const repo = new TagRepository(db);

    // Both "requests" try to create+attach the same tag name at once; the
    // unique-slug conflict must be absorbed (no throw), both providers tagged.
    await Promise.all([
      repo.replaceProviderTags("p-1", ["shared-tag"]),
      repo.replaceProviderTags("p-2", ["shared-tag"]),
    ]);
    const t1 = await repo.tagsForProvider("p-1");
    const t2 = await repo.tagsForProvider("p-2");
    expect(t1.map((t) => t.slug)).toEqual(["shared-tag"]);
    expect(t2.map((t) => t.slug)).toEqual(["shared-tag"]);
    expect(t1[0].id).toBe(t2[0].id);
    // Only one tag row exists.
    expect(await repo.listWithCounts()).toHaveLength(1);
  });

  it("survives overlapping writes with pre-existing orphan tags", async () => {
    // Postgres probe S5/S6: two writers attaching DIFFERENT tags at once used
    // to deadlock (FK KEY SHARE vs prune DELETE) or silently lose a link when
    // one writer's prune snapshot cascaded the other's fresh link away.
    // SQLite serializes so it cannot reproduce the race, but this locks in the
    // end state the fix must guarantee (no lost tags, no lost links).
    const db = await freshDb();
    await makeUser(db, "u-1");
    await makeUser(db, "u-2");
    await makeProvider(db, "p-1", "u-1");
    await makeProvider(db, "p-2", "u-2");
    const repo = new TagRepository(db);

    for (let i = 0; i < 15; i++) {
      // Seed two orphan tags (created but not attached to anyone).
      await repo.resolveOrCreate([`x-${i}`, `y-${i}`]);
      await Promise.all([
        repo.replaceProviderTags("p-1", [`x-${i}`]),
        repo.replaceProviderTags("p-2", [`y-${i}`]),
      ]);
      const all = await repo.listWithCounts();
      const x = all.find((t) => t.slug === `x-${i}`);
      const y = all.find((t) => t.slug === `y-${i}`);
      expect(x?.count).toBe(1); // both tags survive with exactly one link
      expect(y?.count).toBe(1);
      const t1 = await repo.tagsForProvider("p-1");
      const t2 = await repo.tagsForProvider("p-2");
      expect(t1.map((t) => t.slug)).toEqual([`x-${i}`]);
      expect(t2.map((t) => t.slug)).toEqual([`y-${i}`]);
    }
  });

  it("keeps both links when two writers attach the same orphan tag", async () => {
    // Postgres probe S7: both writers attach the same pre-existing orphan.
    const db = await freshDb();
    await makeUser(db, "u-1");
    await makeUser(db, "u-2");
    await makeProvider(db, "p-1", "u-1");
    await makeProvider(db, "p-2", "u-2");
    const repo = new TagRepository(db);

    for (let i = 0; i < 15; i++) {
      await repo.resolveOrCreate([`shared-${i}`]);
      await Promise.all([
        repo.replaceProviderTags("p-1", [`shared-${i}`]),
        repo.replaceProviderTags("p-2", [`shared-${i}`]),
      ]);
      const all = await repo.listWithCounts();
      expect(all.find((t) => t.slug === `shared-${i}`)?.count).toBe(2);
    }
  });

  it("pruneWithLock removes unreferenced tags and keeps linked ones", async () => {
    const db = await freshDb();
    await makeUser(db, "u-1");
    await makeProvider(db, "p-1", "u-1");
    const repo = new TagRepository(db);

    // Create orphans directly (bypassing replaceProviderTags, which prunes
    // inline) to model a crash-left-behind orphan the sweep must clean up.
    await repo.resolveOrCreate(["keep-me", "orphan-1", "orphan-2"]);
    await repo.replaceProviderTags("p-1", ["keep-me"]);
    await repo.resolveOrCreate(["stale-orphan"]);

    const pruned = await repo.pruneWithLock();
    expect(pruned).toBeGreaterThanOrEqual(1);
    expect(await repo.getBySlug("keep-me")).toBeDefined();
    expect(await repo.getBySlug("stale-orphan")).toBeUndefined();
  });
});

describe("RatingRepository", () => {
  it("upserts one rating per user and aggregates", async () => {
    const db = await freshDb();
    await makeUser(db, "u-1");
    await makeUser(db, "u-2");
    await makeProvider(db, "p-1", "u-1");
    const repo = new RatingRepository(db);

    await repo.upsert("p-1", "u-1", 4);
    await repo.upsert("p-1", "u-1", 5); // update wins
    await repo.upsert("p-1", "u-2", 3);

    const summary = await repo.summaryFor("p-1");
    expect(summary.count).toBe(2);
    expect(summary.average).toBe(4); // (5+3)/2
    expect(await repo.myScore("p-1", "u-1")).toBe(5);

    await repo.remove("p-1", "u-1");
    expect(await repo.myScore("p-1", "u-1")).toBeNull();
  });

  it("bulk-summarizes many providers", async () => {
    const db = await freshDb();
    await makeUser(db, "u-1");
    await makeProvider(db, "p-1", "u-1");
    await makeProvider(db, "p-2", "u-1");
    const repo = new RatingRepository(db);
    await repo.upsert("p-1", "u-1", 5);
    const map = await repo.summariesFor(["p-1", "p-2"]);
    expect(map.get("p-1")?.average).toBe(5);
    expect(map.get("p-2")?.count).toBe(0);
  });

  it("is race-safe when the same user rates concurrently", async () => {
    const db = await freshDb();
    await makeUser(db, "u-1");
    await makeProvider(db, "p-1", "u-1");
    const repo = new RatingRepository(db);

    // Two concurrent first-time ratings must not hit the UNIQUE constraint.
    await Promise.all([
      repo.upsert("p-1", "u-1", 4),
      repo.upsert("p-1", "u-1", 5),
    ]);
    const summary = await repo.summaryFor("p-1");
    expect(summary.count).toBe(1); // exactly one row
    expect([4, 5]).toContain(await repo.myScore("p-1", "u-1"));
  });
});

describe("CommentRepository", () => {
  it("inserts and lists with usernames, newest first", async () => {
    const db = await freshDb();
    await makeUser(db, "u-1", "alice");
    await makeUser(db, "u-2", "bob");
    await makeProvider(db, "p-1", "u-1");
    const repo = new CommentRepository(db);

    await repo.insert("p-1", "u-1", "first");
    await repo.insert("p-1", "u-2", "second");
    const list = await repo.listForProvider("p-1");
    expect(list).toHaveLength(2);
    expect(list[0].username).toBe("bob");
    expect(list[1].username).toBe("alice");

    expect((await repo.countsFor(["p-1"])).get("p-1")).toBe(2);
  });
});

describe("UserProfileRepository", () => {
  it("upserts profile fields independently", async () => {
    const db = await freshDb();
    await makeUser(db, "u-1");
    const repo = new UserProfileRepository(db);
    await repo.upsert("u-1", { display_name: "Alice", bio: "hi" });
    const p = await repo.upsert("u-1", { bio: "updated" });
    expect(p.display_name).toBe("Alice");
    expect(p.bio).toBe("updated");
    expect((await repo.getMany(["u-1"])).get("u-1")?.display_name).toBe("Alice");
  });

  it("is race-safe when the same user saves concurrently", async () => {
    const db = await freshDb();
    await makeUser(db, "u-1");
    const repo = new UserProfileRepository(db);

    // First-ever profile save fired twice at once must not fail on the PK.
    const [a, b] = await Promise.all([
      repo.upsert("u-1", { display_name: "Alice" }),
      repo.upsert("u-1", { bio: "hello" }),
    ]);
    expect(a.user_id).toBe("u-1");
    expect(b.user_id).toBe("u-1");
    // Both patches applied (field-level merge semantics preserved).
    const final = await repo.get("u-1");
    expect(final?.display_name).toBe("Alice");
    expect(final?.bio).toBe("hello");
  });
});
