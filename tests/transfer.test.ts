import { afterEach, describe, expect, it } from "vitest";
import {
  createDatabase,
  destroyDatabase,
  type AppDatabase,
} from "@/lib/infra/db";
import { migrateDatabase } from "@/lib/infra/migrate";
import { TransferService } from "@/lib/services/transferService";
import { hashPassword, verifyPassword } from "@/lib/infra/password";
import { decrypt } from "@/lib/infra/crypto";

process.env.MODELHUB_MASTER_KEY =
  process.env.MODELHUB_MASTER_KEY || Buffer.alloc(32, 5).toString("base64");

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

/** Seed a source DB with one row in every exported table. */
async function seedSource(db: AppDatabase) {
  const now = "2026-01-01T00:00:00.000Z";
  await db.insertInto("users").values([
    {
      id: "u-admin",
      username: "admin",
      email: "admin@example.com",
      password_hash: hashPassword("admin-pass-123"),
      role: "admin",
      status: "active",
      token_version: 0,
      slug: "tadmin",
      created_at: now,
      updated_at: now,
    },
    {
      id: "u-bob",
      username: "bob",
      email: null,
      password_hash: hashPassword("bob-pass-123"),
      role: "user",
      status: "active",
      token_version: 3,
      slug: null,
      created_at: now,
      updated_at: now,
    },
  ]).execute();

  await db.insertInto("user_profiles").values({
    user_id: "u-admin",
    display_name: "站长",
    bio: "hello",
    avatar: "https://example.com/a.png",
    updated_at: now,
  }).execute();

  await db.insertInto("tags").values([
    { id: "t-1", slug: "free", name: "免费", created_at: now },
    { id: "t-2", slug: "stable", name: "稳定", created_at: now },
  ]).execute();

  await db.insertInto("user_providers").values({
    id: "p-1",
    user_id: "u-admin",
    name: "Cat API",
    description: "desc",
    type: "newapi",
    base_url: "https://api.cat.top",
    normalized_base_url: "https://api.cat.top",
    free_tier: "free",
    icon: "https://api.cat.top/logo.png",
    adapter: "openai-compatible",
    aff_code: "dl7w",
    catalog_slugs: JSON.stringify({}),
    key_enc: JSON.stringify({
      v: 1,
      iv: "AAAA",
      ct: "BBBB",
      tag: "CCCC",
    }),
    manual_models: 1,
    register_methods: JSON.stringify(["密码注册"]),
  }).execute();

  await db.insertInto("model_caches").values({
    user_provider_id: "p-1",
    models: JSON.stringify(["gpt-4o", "o3"]),
    count: 2,
    last_fetched: now,
    last_status: "ok",
    last_error: null,
    updated_at: now,
  }).execute();

  await db.insertInto("provider_tags").values([
    { user_provider_id: "p-1", tag_id: "t-1" },
    { user_provider_id: "p-1", tag_id: "t-2" },
  ]).execute();

  await db.insertInto("ratings").values({
    id: "r-1",
    user_provider_id: "p-1",
    user_id: "u-bob",
    score: 5,
    created_at: now,
    updated_at: now,
  }).execute();

  await db.insertInto("comments").values({
    id: "c-1",
    user_provider_id: "p-1",
    user_id: "u-bob",
    body: "很好用",
    created_at: now,
    updated_at: now,
  }).execute();

  await db.insertInto("provider_stats").values({
    normalized_base_url: "https://api.cat.top",
    base_url: "https://api.cat.top",
    name: "Cat API",
    icon: null,
    type: "newapi",
    free_tier: "free",
    admin_name: "管理员定的名字",
    admin_icon: "https://x/y.png",
    admin_type: "proxy",
    admin_free_tier: "full",
    type_votes: JSON.stringify({ newapi: 1 }),
    free_tier_votes: JSON.stringify({ free: 1 }),
    user_count: 1,
    updated_at: now,
  }).execute();

  await db.insertInto("key_pool").values({
    id: "k-1",
    normalized_base_url: "https://api.cat.top",
    contributor_user_id: "u-admin",
    key_enc: JSON.stringify({ v: 1, iv: "AAAA", ct: "DDDD", tag: "EEEE" }),
    status: "valid",
    fail_count: 0,
    updated_at: now,
  }).execute();

  await db.insertInto("settings").values([
    { key: "registration_enabled", value: JSON.stringify(true) },
    { key: "personal_pages_enabled", value: JSON.stringify(false) },
  ]).execute();
}

describe("TransferService", () => {
  it("round-trips every table into a fresh database", async () => {
    const src = await freshDb();
    await seedSource(src);
    const target = await freshDb();

    const bundle = await new TransferService(src).export({ includeSecrets: false });
    const summary = await new TransferService(target).import(bundle, { mode: "merge" });

    // Counts match what was seeded.
    expect(summary.imported.users).toBe(2);
    expect(summary.imported.user_providers).toBe(1);
    expect(summary.imported.model_caches).toBe(1);
    expect(summary.imported.provider_tags).toBe(2);
    expect(summary.imported.ratings).toBe(1);
    expect(summary.imported.comments).toBe(1);
    expect(summary.imported.tags).toBe(2);
    expect(summary.imported.provider_stats).toBe(1);
    expect(summary.skipped).toBe(0);

    // Spot-check content, including the model list JSON and comment body.
    const prov = await target
      .selectFrom("user_providers")
      .selectAll()
      .where("id", "=", "p-1")
      .executeTakeFirstOrThrow();
    expect(prov.name).toBe("Cat API");
    expect(prov.aff_code).toBe("dl7w");

    const cache = await target
      .selectFrom("model_caches")
      .selectAll()
      .where("user_provider_id", "=", "p-1")
      .executeTakeFirstOrThrow();
    expect(JSON.parse(cache.models)).toEqual(["gpt-4o", "o3"]);

    const comment = await target
      .selectFrom("comments")
      .selectAll()
      .where("id", "=", "c-1")
      .executeTakeFirstOrThrow();
    expect(comment.body).toBe("很好用");

    // Admin override survives (it is authored data, not recomputable).
    const stat = await target
      .selectFrom("provider_stats")
      .selectAll()
      .where("normalized_base_url", "=", "https://api.cat.top")
      .executeTakeFirstOrThrow();
    expect(stat.admin_name).toBe("管理员定的名字");
    expect(stat.admin_type).toBe("proxy");
  });

  it("keeps password hashes working on the target server", async () => {
    const src = await freshDb();
    await seedSource(src);
    const target = await freshDb();

    const bundle = await new TransferService(src).export({ includeSecrets: false });
    await new TransferService(target).import(bundle, { mode: "merge" });

    const bob = await target
      .selectFrom("users")
      .select("password_hash")
      .where("username", "=", "bob")
      .executeTakeFirstOrThrow();
    // The original password must still verify — nobody resets anything.
    expect(verifyPassword("bob-pass-123", bob.password_hash)).toBe(true);
    expect(verifyPassword("wrong", bob.password_hash)).toBe(false);
  });

  it("drops key material by default so the file is safe to move", async () => {
    const src = await freshDb();
    await seedSource(src);

    const bundle = await new TransferService(src).export({ includeSecrets: false });
    expect(bundle.includes_secrets).toBe(false);

    const prov = (bundle.data.user_providers as Record<string, unknown>[])[0];
    expect(prov.key_enc).toBeNull();
    expect(prov.key_plain).toBeUndefined();

    // Key-pool rows carry nothing without their secret, so they are omitted.
    expect(bundle.data.key_pool).toEqual([]);

    // The JSON must not contain the encrypted blobs anywhere.
    const json = JSON.stringify(bundle);
    expect(json).not.toContain("DDDD");
    expect(json).not.toContain('"iv":"AAAA"');
  });

  it("re-encrypts carried secrets with the TARGET master key", async () => {
    const src = await freshDb();
    await seedSource(src);
    // Put a real encrypted key on the source so decryption is meaningful.
    const { encrypt } = await import("@/lib/infra/crypto");
    await src
      .updateTable("user_providers")
      .set({ key_enc: JSON.stringify(encrypt("sk-live-secret")) })
      .where("id", "=", "p-1")
      .execute();

    const bundle = await new TransferService(src).export({ includeSecrets: true });
    expect(bundle.includes_secrets).toBe(true);
    const carried = (bundle.data.user_providers as Record<string, unknown>[])[0];
    expect(carried.key_plain).toBe("sk-live-secret");

    const target = await freshDb();
    await new TransferService(target).import(bundle, { mode: "merge" });

    const row = await target
      .selectFrom("user_providers")
      .select("key_enc")
      .where("id", "=", "p-1")
      .executeTakeFirstOrThrow();
    expect(row.key_enc).toBeTruthy();
    // The stored value must decrypt back to the original key.
    expect(decrypt(JSON.parse(row.key_enc!))).toBe("sk-live-secret");
  });

  it("replace mode clears existing rows and refuses to remove the last admin", async () => {
    const src = await freshDb();
    await seedSource(src);
    const target = await freshDb();
    // Pre-existing junk on the target that replace must remove.
    await target.insertInto("users").values({
      id: "stale",
      username: "stale",
      email: null,
      password_hash: "x",
      role: "user",
      status: "active",
      token_version: 0,
      slug: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    }).execute();

    const bundle = await new TransferService(src).export({ includeSecrets: false });
    await new TransferService(target).import(bundle, { mode: "replace" });

    const stale = await target
      .selectFrom("users")
      .select("id")
      .where("id", "=", "stale")
      .executeTakeFirst();
    expect(stale).toBeUndefined();
    const count = await target
      .selectFrom("users")
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .executeTakeFirstOrThrow();
    expect(Number(count.n)).toBe(2);

    // A bundle with no active admin must be refused in replace mode.
    const noAdmin = JSON.parse(JSON.stringify(bundle));
    noAdmin.data.users = noAdmin.data.users.map(
      (u: Record<string, unknown>) => ({ ...u, role: "user" })
    );
    await expect(
      new TransferService(target).import(noAdmin, { mode: "replace" })
    ).rejects.toThrow(/管理员/);
  });

  it("rejects a malformed bundle without touching the database", async () => {
    const db = await freshDb();
    await seedSource(db);
    const svc = new TransferService(db);

    await expect(svc.import({ nope: true }, { mode: "merge" })).rejects.toThrow(
      /格式不正确/
    );
    // Missing required field inside a table.
    await expect(
      svc.import(
        {
          format: "modelhub-export",
          version: 1,
          data: { users: [{ id: "x" }] },
        },
        { mode: "merge" }
      )
    ).rejects.toThrow(/缺少字段/);
    // A future version is refused rather than half-applied.
    await expect(
      svc.import(
        { format: "modelhub-export", version: 99, data: {} },
        { mode: "merge" }
      )
    ).rejects.toThrow(/版本/);

    // Nothing was written or removed.
    const n = await db
      .selectFrom("users")
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .executeTakeFirstOrThrow();
    expect(Number(n.n)).toBe(2);
  });

  it("rejects hostile value types with a clean VALIDATION error, not a raw TypeError", async () => {
    const db = await freshDb();
    await seedSource(db);
    const svc = new TransferService(db);

    const base = {
      format: "modelhub-export",
      version: 1,
    } as const;
    const now = "2026-01-01T00:00:00.000Z";
    const userRow = (extra: Record<string, unknown>) => ({
      id: "advbool1",
      username: "advbool1",
      email: null,
      password_hash: "h",
      role: "user",
      status: "active",
      token_version: 0,
      slug: null,
      created_at: now,
      updated_at: now,
      ...extra,
    });

    // A boolean/object/array where a string or number belongs must not reach
    // the SQLite binder (raw TypeError -> 500).
    const hostile: Record<string, unknown>[] = [
      { token_version: true },
      { username: { x: 1 } },
      { username: [1, 2] },
      { id: [] },
    ];
    for (const extra of hostile) {
      await expect(
        svc.import(
          { ...base, data: { users: [userRow(extra)] } },
          { mode: "merge" }
        ),
        JSON.stringify(extra)
      ).rejects.toMatchObject({ code: "VALIDATION" });
    }
  });

  it("rejects non-finite numbers that would silently corrupt a column", async () => {
    const db = await freshDb();
    await seedSource(db);
    const svc = new TransferService(db);

    // Infinity passes a presence check, stores as SQLite `real`, then
    // JSON.stringify turns it into null on the next export — so the server's
    // own bundle stops re-importing ("缺少字段"). Refuse it up front.
    await expect(
      svc.import(
        {
          format: "modelhub-export",
          version: 1,
          data: {
            user_providers: [
              {
                id: "p-inf",
                user_id: "u-admin",
                name: "Inf",
                description: null,
                type: "newapi",
                base_url: "https://inf.example.com",
                normalized_base_url: "https://inf.example.com",
                free_tier: "none",
                icon: null,
                adapter: "openai-compatible",
                aff_code: null,
                catalog_slugs: "{}",
                key_enc: null,
                manual_models: Infinity,
                register_methods: "[]",
              },
            ],
          },
        },
        { mode: "merge" }
      )
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("encrypts a plaintext smtp_password instead of storing it raw", async () => {
    const db = await freshDb();
    await seedSource(db);
    const svc = new TransferService(db);
    const PLAINTEXT = "ADV-PLAINTEXT-SMTP-PW";

    // A hand-crafted bundle (no value_plain marker) must not downgrade the
    // at-rest encryption guarantee for a secret column.
    await svc.import(
      {
        format: "modelhub-export",
        version: 1,
        data: { settings: [{ key: "smtp_password", value: PLAINTEXT }] },
      },
      { mode: "merge" }
    );

    const row = await db
      .selectFrom("settings")
      .selectAll()
      .where("key", "=", "smtp_password")
      .executeTakeFirstOrThrow();
    expect(row.value).not.toContain(PLAINTEXT);
    // And it must remain readable through the secret API.
    const { SettingsRepository } = await import(
      "@/lib/infra/repositories/settingsRepo"
    );
    expect(await new SettingsRepository(db).getSecret("smtp_password")).toBe(
      PLAINTEXT
    );
  });

  it("merge mode is idempotent and updates changed rows", async () => {
    const src = await freshDb();
    await seedSource(src);
    const target = await freshDb();
    const svc = new TransferService(target);

    const bundle = await new TransferService(src).export({ includeSecrets: false });
    await svc.import(bundle, { mode: "merge" });
    await svc.import(bundle, { mode: "merge" }); // second run must not duplicate

    const users = await target
      .selectFrom("users")
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .executeTakeFirstOrThrow();
    expect(Number(users.n)).toBe(2);
    const tags = await target
      .selectFrom("provider_tags")
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .executeTakeFirstOrThrow();
    expect(Number(tags.n)).toBe(2);

    // A changed field in a newer export is applied on re-import.
    const edited = JSON.parse(JSON.stringify(bundle));
    edited.data.user_providers[0].name = "Cat API v2";
    await svc.import(edited, { mode: "merge" });
    const prov = await target
      .selectFrom("user_providers")
      .select("name")
      .where("id", "=", "p-1")
      .executeTakeFirstOrThrow();
    expect(prov.name).toBe("Cat API v2");
  });

  it("merges onto a bootstrap admin with the same username but a different id", async () => {
    // The most common migration shape: a fresh server bootstraps its own
    // `admin`, and the bundle also carries an `admin` with a different id.
    // Inserting blindly violates the unique username index.
    const src = await freshDb();
    await seedSource(src);
    const target = await freshDb();
    await target.insertInto("users").values({
      id: "boot-admin-id",
      username: "admin", // same natural key as the bundle's u-admin
      email: null,
      password_hash: hashPassword("bootstrap-pass"),
      role: "admin",
      status: "active",
      token_version: 0,
      slug: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    }).execute();

    const bundle = await new TransferService(src).export({ includeSecrets: false });
    const summary = await new TransferService(target).import(bundle, { mode: "merge" });

    // The bundle's admin merged onto the existing row instead of duplicating.
    expect(summary.remapped).toBe(1);
    const admins = await target
      .selectFrom("users")
      .selectAll()
      .where("username", "=", "admin")
      .execute();
    expect(admins).toHaveLength(1);
    expect(admins[0].id).toBe("boot-admin-id");
    // The bundle's admin data won (email/password_hash from the source).
    expect(admins[0].email).toBe("admin@example.com");
    expect(verifyPassword("admin-pass-123", admins[0].password_hash)).toBe(true);

    // Child rows followed the remap: the provider belongs to the surviving id.
    const prov = await target
      .selectFrom("user_providers")
      .select("user_id")
      .where("id", "=", "p-1")
      .executeTakeFirstOrThrow();
    expect(prov.user_id).toBe("boot-admin-id");
    // ...and the profile landed on it too.
    const profile = await target
      .selectFrom("user_profiles")
      .select("user_id")
      .where("user_id", "=", "boot-admin-id")
      .executeTakeFirst();
    expect(profile).toBeTruthy();
    // No orphaned children pointing at the old id.
    const stray = await target
      .selectFrom("user_profiles")
      .select("user_id")
      .where("user_id", "=", "u-admin")
      .executeTakeFirst();
    expect(stray).toBeUndefined();
  });

  it("merges a rating onto an existing (provider, user) row with a different id", async () => {
    // ratings are UNIQUE on (user_provider_id, user_id). A re-import whose
    // rating row carries a new id but the same pair must update, not insert.
    const src = await freshDb();
    await seedSource(src);
    const target = await freshDb();

    const first = await new TransferService(src).export({ includeSecrets: false });
    await new TransferService(target).import(first, { mode: "merge" });

    // Same pair, different rating id and a changed score.
    const second = JSON.parse(JSON.stringify(first));
    second.data.ratings = second.data.ratings.map(
      (r: Record<string, unknown>) => ({ ...r, id: "r-renumbered", score: 3 })
    );
    const summary = await new TransferService(target).import(second, {
      mode: "merge",
    });

    const rows = await target
      .selectFrom("ratings")
      .selectAll()
      .where("user_provider_id", "=", "p-1")
      .execute();
    expect(rows).toHaveLength(1); // no duplicate pair
    expect(rows[0].score).toBe(3); // the update applied
    expect(summary.remapped).toBeGreaterThan(0);
  });

  it("does not merge one user's providers into another's", async () => {
    // user_providers is UNIQUE on the PAIR (user_id, normalized_base_url).
    // Matching column-by-column would wrongly collapse distinct rows.
    const src = await freshDb();
    await seedSource(src);
    await src.insertInto("user_providers").values({
      id: "p-2",
      user_id: "u-bob", // different user, different url
      name: "Other API",
      description: null,
      type: "custom",
      base_url: "https://api.other.top",
      normalized_base_url: "https://api.other.top",
      free_tier: "none",
      icon: null,
      adapter: "openai-compatible",
      aff_code: null,
      catalog_slugs: "{}",
      key_enc: null,
      manual_models: 0,
      register_methods: "[]",
    }).execute();

    const target = await freshDb();
    const bundle = await new TransferService(src).export({ includeSecrets: false });
    await new TransferService(target).import(bundle, { mode: "merge" });

    const provs = await target
      .selectFrom("user_providers")
      .selectAll()
      .orderBy("id", "asc")
      .execute();
    expect(provs).toHaveLength(2); // both kept, none collapsed
    expect(provs.map((p) => p.id).sort()).toEqual(["p-1", "p-2"]);
    expect(provs.find((p) => p.id === "p-1")?.user_id).toBe("u-admin");
    expect(provs.find((p) => p.id === "p-2")?.user_id).toBe("u-bob");
  });

  it("skips orphan child rows instead of failing the whole import", async () => {
    const src = await freshDb();
    await seedSource(src);
    const target = await freshDb();

    const bundle = await new TransferService(src).export({ includeSecrets: false });
    // Point a comment at a provider that is not in the bundle.
    bundle.data.comments = [
      ...(bundle.data.comments as Record<string, unknown>[]),
      {
        id: "c-orphan",
        user_provider_id: "p-missing",
        user_id: "u-bob",
        body: "orphan",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ];

    const summary = await new TransferService(target).import(bundle, {
      mode: "merge",
    });
    expect(summary.skipped).toBe(1);
    expect(summary.imported.comments).toBe(1);
    const orphan = await target
      .selectFrom("comments")
      .select("id")
      .where("id", "=", "c-orphan")
      .executeTakeFirst();
    expect(orphan).toBeUndefined();
  });

  it("replace mode refuses a bundle whose only admin has an unusable password hash", async () => {
    const db = await freshDb();
    await seedSource(db);
    const svc = new TransferService(db);
    const now = "2026-01-01T00:00:00.000Z";

    // The guard must protect against a LOCKOUT, not just a missing admin:
    // a garbage hash leaves nobody able to log in.
    await expect(
      svc.import(
        {
          format: "modelhub-export",
          version: 1,
          data: {
            users: [
              {
                id: "x1",
                username: "admin",
                email: null,
                password_hash: "garbage-not-a-hash",
                role: "admin",
                status: "active",
                token_version: 0,
                slug: null,
                created_at: now,
                updated_at: now,
              },
            ],
          },
        },
        { mode: "replace" }
      )
    ).rejects.toMatchObject({ code: "VALIDATION" });

    // The existing admin is untouched.
    const admin = await db
      .selectFrom("users")
      .selectAll()
      .where("username", "=", "admin")
      .executeTakeFirstOrThrow();
    expect(verifyPassword("admin-pass-123", admin.password_hash)).toBe(true);
  });

  it("replace mode accepts a bundle whose admin hash is a real scrypt hash", async () => {
    const db = await freshDb();
    await seedSource(db);
    const svc = new TransferService(db);
    const now = "2026-01-01T00:00:00.000Z";

    await svc.import(
      {
        format: "modelhub-export",
        version: 1,
        data: {
          users: [
            {
              id: "x1",
              username: "admin",
              email: null,
              password_hash: hashPassword("new-admin-pass"),
              role: "admin",
              status: "active",
              token_version: 0,
              slug: null,
              created_at: now,
              updated_at: now,
            },
          ],
        },
      },
      { mode: "replace" }
    );

    const admin = await db
      .selectFrom("users")
      .selectAll()
      .where("username", "=", "admin")
      .executeTakeFirstOrThrow();
    expect(verifyPassword("new-admin-pass", admin.password_hash)).toBe(true);
  });
});
