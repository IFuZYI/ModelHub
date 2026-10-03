import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDatabase,
  destroyDatabase,
  type AppDatabase,
} from "@/lib/infra/db";
import { migrateDatabase } from "@/lib/infra/migrate";
import { PublicService } from "@/lib/services/publicService";
import { UserService } from "@/lib/services/userService";
import { UserRepository } from "@/lib/infra/repositories/userRepo";
import { UserProviderRepository } from "@/lib/infra/repositories/userProviderRepo";
import { UserProfileRepository } from "@/lib/infra/repositories/userProfileRepo";
import { TagRepository } from "@/lib/infra/repositories/tagRepo";
import { RatingRepository } from "@/lib/infra/repositories/ratingRepo";
import { CommentRepository } from "@/lib/infra/repositories/commentRepo";
import { InviteCodeRepository } from "@/lib/infra/repositories/inviteCodeRepo";
import { InviteCodeService } from "@/lib/services/inviteCodeService";
import * as settingsMod from "@/lib/services/settingsService";

/**
 * ADR-0012: `personal_pages_enabled` is an operator switch on personal pages.
 * When it is OFF, an existing page must return 404 (a "closed" state) and no
 * new slug may be assigned. Enforcing it only in the console UI is not enough:
 * the public endpoint is reachable by URL.
 */

const dbs: AppDatabase[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dbs.splice(0).map((db) => destroyDatabase(db)));
});

async function makeDb(): Promise<AppDatabase> {
  const db = createDatabase({ driver: "sqlite", sqlitePath: ":memory:" });
  await migrateDatabase(db);
  dbs.push(db);
  return db;
}

function publicService(db: AppDatabase) {
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

async function seedUser(db: AppDatabase, slug: string) {
  await new UserRepository(db).insert({
    id: "u-page",
    username: "pageuser",
    email: null,
    password_hash: "x",
    role: "user",
    slug,
  });
}

function stubEnabled(enabled: boolean) {
  vi.spyOn(
    settingsMod.settingsService,
    "getPersonalPagesEnabled"
  ).mockResolvedValue(enabled);
  // personalPage also reads the blank-aff policy on the same path.
  vi.spyOn(settingsMod.settingsService, "getAffBlankPolicy").mockResolvedValue(
    "none"
  );
}

describe("personal_pages_enabled enforcement (ADR-0012)", () => {
  it("serves an existing page when the switch is ON", async () => {
    const db = await makeDb();
    await seedUser(db, "tpage1234567");
    stubEnabled(true);
    const page = await publicService(db).personalPage("tpage1234567");
    expect(page.owner.slug).toBe("tpage1234567");
  });

  it("returns 404 for an existing page when the switch is OFF", async () => {
    const db = await makeDb();
    await seedUser(db, "tpage1234567");
    stubEnabled(false);
    await expect(
      publicService(db).personalPage("tpage1234567")
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("blocks assigning a new slug when the switch is OFF", async () => {
    const db = await makeDb();
    await seedUser(db, null as unknown as string);
    stubEnabled(false);
    const svc = new UserService(new UserRepository(db));
    await expect(svc.assignSlug("u-page")).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("allows assigning a new slug when the switch is ON", async () => {
    const db = await makeDb();
    await seedUser(db, null as unknown as string);
    stubEnabled(true);
    const svc = new UserService(new UserRepository(db));
    const slug = await svc.assignSlug("u-page");
    expect(slug).toMatch(/^[a-z0-9]{12}$/);
  });
});
