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
import { SearchService } from "@/lib/services/searchService";

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

async function makeUser(
  db: AppDatabase,
  id: string,
  username: string,
  slug: string | null = null
) {
  await new UserRepository(db).insert({
    id,
    username,
    email: null,
    password_hash: "x",
    role: "user",
    slug,
  });
}

async function makeProvider(
  db: AppDatabase,
  id: string,
  userId: string,
  name: string,
  models: string[],
  baseUrl = `https://${id}.example.com`
) {
  await new UserProviderRepository(db).upsert({
    id,
    user_id: userId,
    name,
    description: null,
    type: "newapi",
    base_url: baseUrl,
    aff_code: null,
    adapter: "openai-compatible",
    free_tier: "none",
    catalog_slugs: {},
    key_enc: null,
    manual_models: false,
    icon: null,
    register_methods: [],
    models,
    last_fetched: null,
    last_status: "pending",
    last_error: null,
    updated_at: null,
  });
}

function service(db: AppDatabase) {
  return new SearchService(
    new UserProviderRepository(db),
    new UserRepository(db),
    new TagRepository(db),
    new RatingRepository(db)
  );
}

describe("SearchService", () => {
  it("finds sites by model name substring", async () => {
    const db = await freshDb();
    await makeUser(db, "u-1", "alice");
    await makeProvider(db, "p-1", "u-1", "Site A", ["gpt-6", "gpt-4o"]);
    await makeProvider(db, "p-2", "u-1", "Site B", ["claude-sonnet-4"]);

    const result = await service(db).search("gpt-6", { ownerId: "u-1" });
    expect(result.total).toBe(1);
    expect(result.hits[0].id).toBe("p-1");
    expect(result.hits[0].matched_models).toContain("gpt-6");
    expect(result.hits[0].reasons).toContain("model");
  });

  it("finds sites by vendor/source name (e.g. openai)", async () => {
    const db = await freshDb();
    await makeUser(db, "u-1", "alice");
    await makeProvider(db, "p-1", "u-1", "Site A", [
      "openai/gpt-4o",
      "xai/grok-4",
    ]);
    await makeProvider(db, "p-2", "u-1", "Site B", ["claude-sonnet-4"]);

    const result = await service(db).search("openai", { ownerId: "u-1" });
    expect(result.total).toBe(1);
    expect(result.hits[0].id).toBe("p-1");
    expect(result.hits[0].matched_vendors).toContain("openai");
    expect(result.hits[0].reasons).toContain("vendor");
  });

  it("finds sites by provider name and base_url", async () => {
    const db = await freshDb();
    await makeUser(db, "u-1", "alice");
    await makeProvider(
      db,
      "p-1",
      "u-1",
      "My Relay",
      ["m1"],
      "https://relay.acme.io"
    );

    const svc = service(db);
    expect((await svc.search("relay", { ownerId: "u-1" })).total).toBe(1);
    expect((await svc.search("acme", { ownerId: "u-1" })).total).toBe(1);
  });

  it("scopes hits to the given owner — other users' sites never appear", async () => {
    // The homepage lists ONE owner's sites (the primary admin's) and its
    // search must return exactly that set: an unscoped search previously
    // scanned every user's providers and surfaced other users' sites.
    const db = await freshDb();
    await makeUser(db, "u-1", "alice");
    await makeUser(db, "u-2", "bob");
    await makeProvider(db, "p-1", "u-1", "Site A", ["gpt-6"]);
    await makeProvider(db, "p-2", "u-2", "Site B", ["gpt-6"]);

    const scoped = await service(db).search("gpt-6", { ownerId: "u-1" });
    expect(scoped.total).toBe(1);
    expect(scoped.hits[0].id).toBe("p-1");

    const other = await service(db).search("gpt-6", { ownerId: "u-2" });
    expect(other.total).toBe(1);
    expect(other.hits[0].id).toBe("p-2");
  });

  it("hides the owner's sites when the account is disabled", async () => {
    const db = await freshDb();
    await makeUser(db, "u-1", "alice");
    await makeProvider(db, "p-1", "u-1", "Site A", ["gpt-6"]);
    await new UserRepository(db).update("u-1", { status: "disabled" });

    const result = await service(db).search("gpt-6", { ownerId: "u-1" });
    expect(result.total).toBe(0);
  });

  it("filters by tag within the owner scope", async () => {
    const db = await freshDb();
    await makeUser(db, "u-1", "alice");
    await makeUser(db, "u-2", "bob");
    await makeProvider(db, "p-1", "u-1", "Site A", ["gpt-6"]);
    await makeProvider(db, "p-2", "u-2", "Site B", ["gpt-6"]);

    const tags = new TagRepository(db);
    await tags.replaceProviderTags("p-1", ["cheap"]);
    await tags.replaceProviderTags("p-2", ["cheap"]);

    const byTag = await service(db).search("", {
      ownerId: "u-1",
      tag: "cheap",
    });
    expect(byTag.total).toBe(1);
    expect(byTag.hits[0].id).toBe("p-1");
  });

  it("includes tags and rating in hits, without author fields", async () => {
    const db = await freshDb();
    await makeUser(db, "u-1", "alice");
    await makeProvider(db, "p-1", "u-1", "Site A", ["gpt-6"]);
    const tags = new TagRepository(db);
    await tags.replaceProviderTags("p-1", ["free"]);
    await new RatingRepository(db).upsert("p-1", "u-1", 5);

    const result = await service(db).search("gpt-6", { ownerId: "u-1" });
    const hit = result.hits[0];
    expect(hit.tags[0].slug).toBe("free");
    expect(hit.rating.average).toBe(5);
    // Single-owner scope: the per-hit author identity is redundant and was
    // removed from the payload (and the card UI).
    expect(hit).not.toHaveProperty("author");
  });

  it("returns nothing for empty query without filters", async () => {
    const db = await freshDb();
    await makeUser(db, "u-1", "alice");
    await makeProvider(db, "p-1", "u-1", "Site A", ["gpt-6"]);
    expect((await service(db).search("", { ownerId: "u-1" })).total).toBe(0);
  });
});
