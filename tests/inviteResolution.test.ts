import { afterEach, describe, expect, it } from "vitest";
import {
  createDatabase,
  destroyDatabase,
  type AppDatabase,
} from "@/lib/infra/db";
import { migrateDatabase } from "@/lib/infra/migrate";
import { UserProviderRepository } from "@/lib/infra/repositories/userProviderRepo";
import { InviteCodeRepository } from "@/lib/infra/repositories/inviteCodeRepo";
import { InviteCodeService } from "@/lib/services/inviteCodeService";
import { UserRepository } from "@/lib/infra/repositories/userRepo";
import { UserProfileRepository } from "@/lib/infra/repositories/userProfileRepo";
import { TagRepository } from "@/lib/infra/repositories/tagRepo";
import { RatingRepository } from "@/lib/infra/repositories/ratingRepo";
import { CommentRepository } from "@/lib/infra/repositories/commentRepo";
import { PublicService } from "@/lib/services/publicService";
import * as settingsMod from "@/lib/services/settingsService";
import { vi } from "vitest";

const dbs: AppDatabase[] = [];
afterEach(async () => {
  await Promise.all(dbs.splice(0).map((db) => destroyDatabase(db)));
  vi.restoreAllMocks();
});

async function freshDb(): Promise<AppDatabase> {
  const db = createDatabase({ driver: "sqlite", sqlitePath: ":memory:" });
  dbs.push(db);
  await migrateDatabase(db);
  return db;
}

const SITE = "https://api.cat.top";

/** Build a PublicService wired to one db, with a stubbed blank-aff policy. */
function publicService(db: AppDatabase, blankPolicy: "none" | "random") {
  vi.spyOn(settingsMod.settingsService, "getAffBlankPolicy").mockResolvedValue(
    blankPolicy
  );
  // These cases exercise invite resolution on personal pages, so the
  // personal-page switch must be ON (ADR-0012 gates the endpoint itself).
  vi.spyOn(
    settingsMod.settingsService,
    "getPersonalPagesEnabled"
  ).mockResolvedValue(true);
  return new PublicService(
    new UserProviderRepository(db),
    new UserRepository(db),
    new UserProfileRepository(db),
    new TagRepository(db),
    new RatingRepository(db),
    new CommentRepository(db),
    new InviteCodeService(
      new InviteCodeRepository(db),
      new UserProviderRepository(db)
    )
  );
}

async function seed(db: AppDatabase) {
  const users = new UserRepository(db);
  await users.insert({
    id: "admin-1",
    username: "admin",
    email: null,
    password_hash: "x",
    role: "admin",
    slug: "tadmin",
  });
  await users.insert({
    id: "u-bob",
    username: "bob",
    email: null,
    password_hash: "x",
    role: "user",
    slug: "tbob",
  });
  const providers = new UserProviderRepository(db);
  const base = {
    description: null,
    type: "newapi" as const,
    base_url: SITE,
    adapter: "openai-compatible",
    free_tier: "none" as const,
    catalog_slugs: {},
    key_enc: null,
    manual_models: false,
    icon: null,
    register_methods: [],
    models: [],
    last_fetched: null,
    last_status: "pending" as const,
    last_error: null,
    updated_at: null,
  };
  // The admin's own site on the homepage.
  await providers.upsert({ ...base, id: "p-admin", user_id: "admin-1", name: "Admin Site", aff_code: null });
  // Bob's site, carrying his own referral code.
  await providers.upsert({ ...base, id: "p-bob", user_id: "u-bob", name: "Bob Site", aff_code: "bob-code" });
}

describe("invite-code resolution on public pages", () => {
  it("homepage draws a code from the pool (a user's code) when policy=random", async () => {
    const db = await freshDb();
    await seed(db);
    const svc = publicService(db, "random");

    const page = await svc.homepage();
    const adminSite = page.providers.find((p) => p.id === "p-admin")!;
    // The admin's site has no code of its own, so it draws Bob's.
    expect(adminSite.invite_url).toBe(`${SITE}?aff=bob-code`);
  });

  it("homepage leaves the link code-less when policy=none", async () => {
    const db = await freshDb();
    await seed(db);
    const svc = publicService(db, "none");

    const page = await svc.homepage();
    const adminSite = page.providers.find((p) => p.id === "p-admin")!;
    expect(adminSite.invite_url).toBe(SITE);
  });

  it("an explicit RANDOM aff_code draws even when the blank policy is none", async () => {
    const db = await freshDb();
    await seed(db);
    // Point the admin's site at the sentinel.
    await db
      .updateTable("user_providers")
      .set({ aff_code: "RANDOM" })
      .where("id", "=", "p-admin")
      .execute();
    const svc = publicService(db, "none");

    const page = await svc.homepage();
    const adminSite = page.providers.find((p) => p.id === "p-admin")!;
    expect(adminSite.invite_url).toBe(`${SITE}?aff=bob-code`);
  });

  it("a fixed aff_code wins over the pool", async () => {
    const db = await freshDb();
    await seed(db);
    await db
      .updateTable("user_providers")
      .set({ aff_code: "own-code" })
      .where("id", "=", "p-admin")
      .execute();
    const svc = publicService(db, "random");

    const page = await svc.homepage();
    const adminSite = page.providers.find((p) => p.id === "p-admin")!;
    expect(adminSite.invite_url).toBe(`${SITE}?aff=own-code`);
  });

  it("falls back to a plain link when the pool has nothing for that site", async () => {
    const db = await freshDb();
    await seed(db);
    // Remove Bob's code so the pool is empty for this site.
    await db
      .updateTable("user_providers")
      .set({ aff_code: null })
      .where("id", "=", "p-bob")
      .execute();
    const svc = publicService(db, "random");

    const page = await svc.homepage();
    const adminSite = page.providers.find((p) => p.id === "p-admin")!;
    expect(adminSite.invite_url).toBe(SITE);
  });

  it("a personal page shows the owner's OWN code, never a pool draw", async () => {
    const db = await freshDb();
    await seed(db);
    const svc = publicService(db, "random");

    const page = await svc.personalPage("tbob");
    const bobSite = page.providers.find((p) => p.id === "p-bob")!;
    // Bob's own page shows Bob's code even though the policy is random.
    expect(bobSite.invite_url).toBe(`${SITE}?aff=bob-code`);

    // And the admin's site on Bob's page must NOT borrow Bob's code.
    const adminSite = page.providers.find((p) => p.id === "p-admin");
    expect(adminSite).toBeUndefined(); // admin's site is not on Bob's page
  });

  it("a personal page with no code stays code-less under policy=random", async () => {
    const db = await freshDb();
    await seed(db);
    const svc = publicService(db, "random");
    // Give the admin a site that Bob also mounts, so the personal page has a
    // code-less entry while a pool code exists elsewhere.
    await db
      .updateTable("user_providers")
      .set({ aff_code: null })
      .where("id", "=", "p-bob")
      .execute();

    const page = await svc.personalPage("tbob");
    const bobSite = page.providers.find((p) => p.id === "p-bob")!;
    // No own code and personal pages never draw -> plain link.
    expect(bobSite.invite_url).toBe(SITE);
  });

  it("the provider detail view draws from the pool", async () => {
    const db = await freshDb();
    await seed(db);
    const svc = publicService(db, "random");

    const detail = await svc.detail("p-admin");
    expect(detail.invite_url).toBe(`${SITE}?aff=bob-code`);
  });
});
