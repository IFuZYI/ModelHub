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
import { normalizeBaseUrl } from "@/lib/domain/provider";
import { isRandomAffCode } from "@/lib/domain/provider";

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

const SITE = "https://api.cat.top";

async function makeUser(db: AppDatabase, id: string) {
  await new UserRepository(db).insert({
    id,
    username: id,
    email: null,
    password_hash: "x",
    role: "user",
  });
}

async function makeProvider(
  db: AppDatabase,
  id: string,
  userId: string,
  affCode: string | null,
  baseUrl = SITE,
  name = id
) {
  await new UserProviderRepository(db).upsert({
    id,
    user_id: userId,
    name,
    description: null,
    type: "newapi",
    base_url: baseUrl,
    aff_code: affCode,
    adapter: "openai-compatible",
    free_tier: "none",
    catalog_slugs: {},
    key_enc: null,
    manual_models: false,
    icon: null,
    register_methods: [],
    models: [],
    last_fetched: null,
    last_status: "pending",
    last_error: null,
    updated_at: null,
  });
}

function service(db: AppDatabase) {
  return new InviteCodeService(
    new InviteCodeRepository(db),
    new UserProviderRepository(db)
  );
}

describe("isRandomAffCode", () => {
  it("matches the sentinel case-insensitively, with surrounding space", () => {
    expect(isRandomAffCode("RANDOM")).toBe(true);
    expect(isRandomAffCode("random")).toBe(true);
    expect(isRandomAffCode("  Random ")).toBe(true);
  });

  it("does not match real codes or blanks", () => {
    expect(isRandomAffCode("dl7w")).toBe(false);
    expect(isRandomAffCode("")).toBe(false);
    expect(isRandomAffCode(null)).toBe(false);
    expect(isRandomAffCode(undefined)).toBe(false);
  });
});

describe("InviteCodeService", () => {
  it("merges user-typed codes with admin-registered ones per site", async () => {
    const db = await freshDb();
    await makeUser(db, "u-1");
    await makeProvider(db, "p-1", "u-1", "user-code", SITE, "Cat API");
    const svc = service(db);
    await svc.addCode(SITE, "admin-code", "运营的码");

    const codes = await svc.codesForUrl(normalizeBaseUrl(SITE));
    expect(codes.map((c) => c.code).sort()).toEqual(["admin-code", "user-code"]);
    const admin = codes.find((c) => c.code === "admin-code");
    expect(admin?.source).toBe("admin");
    expect(admin?.label).toBe("运营的码");
    const user = codes.find((c) => c.code === "user-code");
    expect(user?.source).toBe("user");
    expect(user?.label).toBe("Cat API");
  });

  it("never treats the RANDOM sentinel as a drawable code", async () => {
    const db = await freshDb();
    await makeUser(db, "u-1");
    await makeProvider(db, "p-1", "u-1", "RANDOM");
    const codes = await service(db).codesForUrl(normalizeBaseUrl(SITE));
    expect(codes).toHaveLength(0);
  });

  it("keeps a site's codes isolated from another site's", async () => {
    const db = await freshDb();
    await makeUser(db, "u-1");
    await makeProvider(db, "p-1", "u-1", "cat-code", SITE);
    await makeProvider(db, "p-2", "u-1", "dog-code", "https://api.dog.top");
    const svc = service(db);
    const cat = await svc.codesForUrl(normalizeBaseUrl(SITE));
    expect(cat.map((c) => c.code)).toEqual(["cat-code"]);
  });

  it("de-duplicates a code that is both user-typed and admin-registered", async () => {
    const db = await freshDb();
    await makeUser(db, "u-1");
    await makeProvider(db, "p-1", "u-1", "same-code");
    const svc = service(db);
    await svc.addCode(SITE, "same-code", "也登记了一次");
    const codes = await svc.codesForUrl(normalizeBaseUrl(SITE));
    expect(codes).toHaveLength(1);
    // The admin registration is the more authoritative label.
    expect(codes[0].source).toBe("admin");
  });

  it("addCode is idempotent and rejects the RANDOM sentinel", async () => {
    const db = await freshDb();
    const svc = service(db);
    await svc.addCode(SITE, "dup", null);
    await svc.addCode(SITE, "dup", null);
    const codes = await svc.codesForUrl(normalizeBaseUrl(SITE));
    expect(codes).toHaveLength(1);

    await expect(svc.addCode(SITE, "RANDOM", null)).rejects.toThrow(/保留值/);
    await expect(svc.addCode(SITE, "   ", null)).rejects.toThrow(/不能为空/);
  });

  it("rejects codes that could not be used as an aff code", async () => {
    const db = await freshDb();
    const svc = service(db);
    // A pooled code ends up in ?aff=<code>, so it must satisfy the same
    // charset as a provider's aff_code — otherwise the pool accepts values
    // the rest of the system rejects, and a URL-injection payload
    // (&, =, #, ?) or a lone surrogate gets stored and served.
    for (const bad of ["a&b", "a=b", "a#b", "a?b", "a b", "a/b", "\uD800", "码"]) {
      await expect(svc.addCode(SITE, bad, null)).rejects.toMatchObject({
        code: "VALIDATION",
      });
    }
    expect(await svc.codesForUrl(normalizeBaseUrl(SITE))).toHaveLength(0);
  });

  it("draw returns null when the pool is empty, else an eligible code", async () => {
    const db = await freshDb();
    const svc = service(db);
    expect(await svc.draw(normalizeBaseUrl(SITE), "seed")).toBeNull();

    await svc.addCode(SITE, "only-code", null);
    expect(await svc.draw(normalizeBaseUrl(SITE), "seed")).toBe("only-code");
  });

  it("draw is deterministic for one seed and spreads across seeds", async () => {
    const db = await freshDb();
    const svc = service(db);
    for (const c of ["a1", "b2", "c3", "d4", "e5"]) {
      await svc.addCode(SITE, c, null);
    }
    const url = normalizeBaseUrl(SITE);

    // Same seed -> same code (one page shows one consistent code).
    const first = await svc.draw(url, "page-1");
    expect(await svc.draw(url, "page-1")).toBe(first);

    // Different seeds should reach more than one code across many draws.
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      seen.add((await svc.draw(url, `seed-${i}`))!);
    }
    expect(seen.size).toBeGreaterThan(1);
    // Every drawn value is a real pool code.
    for (const c of seen) expect(["a1", "b2", "c3", "d4", "e5"]).toContain(c);
  });

  it("listPools groups by site across both sources", async () => {
    const db = await freshDb();
    await makeUser(db, "u-1");
    await makeProvider(db, "p-1", "u-1", "user-a", SITE, "Cat API");
    const svc = service(db);
    await svc.addCode(SITE, "admin-a", null);
    // A site that only has an admin code (no provider anywhere).
    await svc.addCode("https://api.lonely.top", "lonely-code", null);

    const pools = await svc.listPools();
    const cat = pools.find((p) => p.normalized_base_url === normalizeBaseUrl(SITE));
    expect(cat?.codes.map((c) => c.code).sort()).toEqual([
      "admin-a",
      "user-a",
    ]);
    const lonely = pools.find(
      (p) => p.normalized_base_url === normalizeBaseUrl("https://api.lonely.top")
    );
    expect(lonely?.codes).toHaveLength(1);
  });

  it("removeCode deletes only the registered row, not the user's code", async () => {
    const db = await freshDb();
    await makeUser(db, "u-1");
    await makeProvider(db, "p-1", "u-1", "user-code");
    const svc = service(db);
    await svc.addCode(SITE, "admin-code", null);

    const before = await svc.codesForUrl(normalizeBaseUrl(SITE));
    const adminRow = before.find((c) => c.code === "admin-code")!;
    await svc.removeCode(adminRow.id!);

    const after = await svc.codesForUrl(normalizeBaseUrl(SITE));
    expect(after.map((c) => c.code)).toEqual(["user-code"]);
  });
});
