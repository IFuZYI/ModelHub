import { afterEach, describe, expect, it } from "vitest";
import {
  createDatabase,
  destroyDatabase,
  type AppDatabase,
} from "@/lib/infra/db";
import { migrateDatabase } from "@/lib/infra/migrate";
import { UserRepository } from "@/lib/infra/repositories/userRepo";
import { UserProviderRepository } from "@/lib/infra/repositories/userProviderRepo";
import { StatsRepository } from "@/lib/infra/repositories/statsRepo";
import { UserService } from "@/lib/services/userService";
import { StatsService } from "@/lib/services/statsService";

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

describe("UserService admin safety guards", () => {
  it("refuses to demote the only admin", async () => {
    const db = await freshDb();
    const svc = new UserService(new UserRepository(db));
    const admin = await svc.create({
      username: "admin",
      password: "password123",
      role: "admin",
    });
    await expect(
      svc.update(admin.id, { role: "user" })
    ).rejects.toThrow(/唯一的管理员/);
  });

  it("refuses to disable the only admin", async () => {
    const db = await freshDb();
    const svc = new UserService(new UserRepository(db));
    const admin = await svc.create({
      username: "admin",
      password: "password123",
      role: "admin",
    });
    await expect(
      svc.update(admin.id, { status: "disabled" })
    ).rejects.toThrow(/唯一的管理员/);
  });

  it("allows demoting an admin when another admin remains", async () => {
    const db = await freshDb();
    const svc = new UserService(new UserRepository(db));
    const a = await svc.create({
      username: "admin1",
      password: "password123",
      role: "admin",
    });
    await svc.create({
      username: "admin2",
      password: "password123",
      role: "admin",
    });
    const demoted = await svc.update(a.id, { role: "user" });
    expect(demoted.role).toBe("user");
  });

  it("refuses to delete the only admin", async () => {
    const db = await freshDb();
    const svc = new UserService(new UserRepository(db));
    const admin = await svc.create({
      username: "admin",
      password: "password123",
      role: "admin",
    });
    await expect(svc.remove(admin.id)).rejects.toThrow(/唯一的管理员/);
  });
});

describe("UserService email uniqueness", () => {
  it("rejects an update that would collide with another user's email", async () => {
    const db = await freshDb();
    const svc = new UserService(new UserRepository(db));
    await svc.create({
      username: "alice",
      password: "password123",
      email: "alice@example.com",
    });
    const bob = await svc.create({
      username: "bob",
      password: "password123",
      email: "bob@example.com",
    });
    // The users.email UNIQUE constraint must surface as a clean 400, not a 500.
    await expect(
      svc.update(bob.id, { email: "alice@example.com" })
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects a create that collides with an existing email", async () => {
    const db = await freshDb();
    const svc = new UserService(new UserRepository(db));
    await svc.create({
      username: "alice",
      password: "password123",
      email: "alice@example.com",
    });
    await expect(
      svc.create({
        username: "carol",
        password: "password123",
        email: "alice@example.com",
      })
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("allows a user to keep their own email on update", async () => {
    const db = await freshDb();
    const svc = new UserService(new UserRepository(db));
    const alice = await svc.create({
      username: "alice",
      password: "password123",
      email: "alice@example.com",
    });
    const updated = await svc.update(alice.id, { email: "alice@example.com" });
    expect(updated.email).toBe("alice@example.com");
  });
});

describe("UserService deletion recomputes the stats aggregate", () => {
  /** Minimal StoredProvider + owner for the stats tests. */
  function owned(id: string, owner: string, url: string) {
    return {
      id,
      user_id: owner,
      name: "Site",
      description: null,
      type: "newapi" as const,
      base_url: url,
      aff_code: null,
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
  }

  it("removes the stats row once the deleted user's only provider is gone", async () => {
    const db = await freshDb();
    const providers = new UserProviderRepository(db);
    const stats = new StatsRepository(db);
    const statsSvc = new StatsService(
      new UserProviderRepository(db),
      new UserRepository(db),
      new StatsRepository(db)
    );
    const svc = new UserService(
      new UserRepository(db),
      new UserProviderRepository(db),
      statsSvc
    );

    const alice = await svc.create({ username: "alice", password: "password123" });
    await providers.upsert(owned("p-alice", alice.id, "https://stats.example.com"));
    await statsSvc.recompute("https://stats.example.com");
    expect(await stats.get("https://stats.example.com")).toBeTruthy();

    // Deleting the user cascades their providers away; the derived aggregate
    // must not keep advertising a site nobody mounts any more.
    await svc.remove(alice.id);
    expect(await stats.get("https://stats.example.com")).toBeUndefined();
  });

  it("recomputes (not removes) a stats row when another user still mounts it", async () => {
    const db = await freshDb();
    const providers = new UserProviderRepository(db);
    const stats = new StatsRepository(db);
    const statsSvc = new StatsService(
      new UserProviderRepository(db),
      new UserRepository(db),
      new StatsRepository(db)
    );
    const svc = new UserService(
      new UserRepository(db),
      new UserProviderRepository(db),
      statsSvc
    );

    const alice = await svc.create({ username: "alice", password: "password123" });
    const bob = await svc.create({ username: "bob", password: "password123" });
    await providers.upsert(owned("p-a", alice.id, "https://shared.example.com"));
    await providers.upsert(owned("p-b", bob.id, "https://shared.example.com"));
    await statsSvc.recompute("https://shared.example.com");
    expect((await stats.get("https://shared.example.com"))?.user_count).toBe(2);

    await svc.remove(alice.id);
    const row = await stats.get("https://shared.example.com");
    expect(row).toBeTruthy();
    expect(row?.user_count).toBe(1);
  });
});
