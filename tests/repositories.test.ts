import { afterEach, describe, expect, it } from "vitest";
import {
  createDatabase,
  destroyDatabase,
  type AppDatabase,
} from "@/lib/infra/db";
import { migrateDatabase } from "@/lib/infra/migrate";
import { UserRepository } from "@/lib/infra/repositories/userRepo";
import {
  UserProviderRepository,
  type OwnedProvider,
} from "@/lib/infra/repositories/userProviderRepo";
import { StatsRepository } from "@/lib/infra/repositories/statsRepo";
import { KeyPoolRepository } from "@/lib/infra/repositories/keyPoolRepo";
import { SettingsRepository } from "@/lib/infra/repositories/settingsRepo";
import { hashPassword, verifyPassword } from "@/lib/infra/password";
import { decrypt } from "@/lib/infra/crypto";

process.env.MODELHUB_MASTER_KEY =
  process.env.MODELHUB_MASTER_KEY || Buffer.alloc(32, 9).toString("base64");

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

function ownedProvider(overrides: Partial<OwnedProvider> = {}): OwnedProvider {
  return {
    id: overrides.id ?? "p-1",
    user_id: overrides.user_id ?? "u-1",
    name: "Example",
    description: null,
    type: "newapi",
    base_url: "https://api.example.com/v1",
    aff_code: null,
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
    ...overrides,
  };
}

async function makeUser(db: AppDatabase, id: string) {
  await new UserRepository(db).insert({
    id,
    username: id,
    email: null,
    password_hash: "x",
    role: "user",
  });
}

describe("password hashing (scrypt)", () => {
  it("round-trips and rejects a wrong password", () => {
    const stored = hashPassword("correct horse");
    expect(verifyPassword("correct horse", stored)).toBe(true);
    expect(verifyPassword("wrong", stored)).toBe(false);
  });

  it("rejects a malformed stored hash", () => {
    expect(verifyPassword("x", "not-a-hash")).toBe(false);
  });
});

describe("UserRepository", () => {
  it("inserts, looks up, and bumps token_version", async () => {
    const db = await freshDb();
    const repo = new UserRepository(db);
    const user = await repo.insert({
      id: "u-1",
      username: "alice",
      email: "a@x.io",
      password_hash: hashPassword("pw"),
      role: "admin",
    });
    expect(user.token_version).toBe(0);
    expect((await repo.getByUsername("alice"))?.id).toBe("u-1");
    expect(await repo.count()).toBe(1);

    const bumped = await repo.update("u-1", { bump_token_version: true });
    expect(bumped?.token_version).toBe(1);
  });

  it("firstActiveAdminId returns the earliest ACTIVE admin, skipping others", async () => {
    const db = await freshDb();
    const repo = new UserRepository(db);
    // Insert order defines created_at order: a plain user first, then two
    // admins — the FIRST admin wins, not the newest, and the non-admin is
    // never a candidate.
    await repo.insert({
      id: "u-user",
      username: "user",
      email: null,
      password_hash: "x",
      role: "user",
    });
    await repo.insert({
      id: "u-admin-1",
      username: "admin1",
      email: null,
      password_hash: "x",
      role: "admin",
    });
    await repo.insert({
      id: "u-admin-2",
      username: "admin2",
      email: null,
      password_hash: "x",
      role: "admin",
    });
    expect(await repo.firstActiveAdminId()).toBe("u-admin-1");

    // A disabled admin is skipped entirely (status matters).
    await repo.update("u-admin-1", { status: "disabled" });
    expect(await repo.firstActiveAdminId()).toBe("u-admin-2");
  });

  it("firstActiveAdminId returns null when no active admin exists", async () => {
    const db = await freshDb();
    const repo = new UserRepository(db);
    await repo.insert({
      id: "u-1",
      username: "plain",
      email: null,
      password_hash: "x",
      role: "user",
    });
    expect(await repo.firstActiveAdminId()).toBeNull();
  });
});

describe("UserProviderRepository", () => {
  it("enforces one URL per user but allows another user the same URL", async () => {
    const db = await freshDb();
    await makeUser(db, "u-1");
    await makeUser(db, "u-2");
    const repo = new UserProviderRepository(db);

    await repo.upsert(ownedProvider({ id: "p-1", user_id: "u-1" }));
    await repo.upsert(ownedProvider({ id: "p-2", user_id: "u-2" }));

    // Same user, same normalized URL, different id → violates unique constraint.
    await expect(
      repo.upsert(ownedProvider({ id: "p-3", user_id: "u-1" }))
    ).rejects.toThrow();

    // Lookup by normalized URL treats /v1 and trailing slash as equal.
    const found = await repo.getByUserAndUrl("u-1", "https://api.example.com/");
    expect(found?.id).toBe("p-1");
  });

  it("persists and reloads the model cache", async () => {
    const db = await freshDb();
    await makeUser(db, "u-1");
    const repo = new UserProviderRepository(db);
    await repo.upsert(
      ownedProvider({ id: "p-1", models: ["gpt-4o", "o3"], last_status: "ok" })
    );
    const got = await repo.getById("p-1");
    expect(got?.models).toEqual(["gpt-4o", "o3"]);
    expect(got?.last_status).toBe("ok");
  });
});

describe("StatsRepository", () => {
  it("keeps admin overrides when derived fields change", async () => {
    const db = await freshDb();
    const repo = new StatsRepository(db);
    await repo.upsertDerived({
      normalized_base_url: "https://api.example.com",
      base_url: "https://api.example.com",
      name: "Derived",
      icon: null,
      type: "newapi",
      free_tier: "free",
      type_votes: { newapi: 3 },
      free_tier_votes: { free: 3 },
      user_count: 3,
    });
    await db
      .updateTable("provider_stats")
      .set({ admin_name: "AdminSet" })
      .where("normalized_base_url", "=", "https://api.example.com")
      .execute();

    await repo.upsertDerived({
      normalized_base_url: "https://api.example.com",
      base_url: "https://api.example.com",
      name: "DerivedChanged",
      icon: null,
      type: "newapi",
      free_tier: "none",
      type_votes: { newapi: 5 },
      free_tier_votes: { none: 5 },
      user_count: 5,
    });

    const stat = await repo.get("https://api.example.com");
    expect(stat?.name).toBe("AdminSet"); // admin override preserved
    expect(stat?.user_count).toBe(5); // derived count updated
    expect(stat?.free_tier_votes).toEqual({ none: 5 });
  });
});

describe("KeyPoolRepository", () => {
  it("stores encrypted keys and deletes after 2 auth failures", async () => {
    const db = await freshDb();
    await makeUser(db, "u-1");
    const pool = new KeyPoolRepository(db);
    await pool.put("https://api.example.com", "u-1", "sk-secret");

    const [key] = await pool.listForUrl("https://api.example.com");
    expect(decrypt(key.key_enc)).toBe("sk-secret");
    expect(key.status).toBe("unverified");

    expect(await pool.recordFailureAndMaybeDelete(key.id)).toBe(false); // 1st
    expect(await pool.recordFailureAndMaybeDelete(key.id)).toBe(true); // 2nd → gone
    expect(await pool.listForUrl("https://api.example.com")).toHaveLength(0);
  });

  it("replaces a contributor's key on re-put", async () => {
    const db = await freshDb();
    await makeUser(db, "u-1");
    const pool = new KeyPoolRepository(db);
    await pool.put("https://api.example.com", "u-1", "sk-old");
    await pool.put("https://api.example.com", "u-1", "sk-new");
    const keys = await pool.listForUrl("https://api.example.com");
    expect(keys).toHaveLength(1);
    expect(decrypt(keys[0].key_enc)).toBe("sk-new");
  });
});

describe("SettingsRepository", () => {
  it("round-trips JSON values and encrypted secrets", async () => {
    const db = await freshDb();
    const repo = new SettingsRepository(db);
    await repo.set("registration_enabled", false);
    expect(await repo.get("registration_enabled", true)).toBe(false);

    await repo.setSecret("smtp_password", "hunter2");
    expect(await repo.getSecret("smtp_password")).toBe("hunter2");
    // Stored form must not be the plaintext.
    expect(await repo.getRaw("smtp_password")).not.toContain("hunter2");

    await repo.setSecret("smtp_password", "");
    expect(await repo.getSecret("smtp_password")).toBeNull();
  });
});
