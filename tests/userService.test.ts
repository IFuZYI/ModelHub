import { afterEach, describe, expect, it } from "vitest";
import {
  createDatabase,
  destroyDatabase,
  type AppDatabase,
} from "@/lib/infra/db";
import { migrateDatabase } from "@/lib/infra/migrate";
import { UserRepository } from "@/lib/infra/repositories/userRepo";
import { UserService } from "@/lib/services/userService";

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
