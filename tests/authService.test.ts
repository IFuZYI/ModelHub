import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDatabase,
  destroyDatabase,
  type AppDatabase,
} from "@/lib/infra/db";
import { migrateDatabase } from "@/lib/infra/migrate";
import { AuthService } from "@/lib/services/authService";
import { UserRepository } from "@/lib/infra/repositories/userRepo";
import { EmailVerificationRepository } from "@/lib/infra/repositories/emailVerificationRepo";
import * as settingsMod from "@/lib/services/settingsService";
import * as mailer from "@/lib/services/mailer";

const dbs: AppDatabase[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dbs.splice(0).map((db) => destroyDatabase(db)));
});

async function freshDb(): Promise<AppDatabase> {
  const db = createDatabase({ driver: "sqlite", sqlitePath: ":memory:" });
  dbs.push(db);
  await migrateDatabase(db);
  return db;
}

function stubSettings(overrides: Partial<settingsMod.PublicSettings>) {
  vi.spyOn(settingsMod.settingsService, "getPublic").mockResolvedValue({
    registration_enabled: true,
    email_verification_required: false,
    email_domain_whitelist: [],
    personal_pages_enabled: false,
    key_share_enabled: false,
    key_share_consumers: "admin",
    aff_blank_policy: "none",
    smtp_host: "",
    smtp_port: null,
    smtp_username: "",
    smtp_from: "",
    smtp_password_set: false,
    ...overrides,
  });
}

describe("AuthService registration + verification", () => {
  it("creates an account immediately when verification is off", async () => {
    const db = await freshDb();
    stubSettings({ registration_enabled: true });
    const svc = new AuthService(
      new UserRepository(db),
      new EmailVerificationRepository(db)
    );
    const result = await svc.register({ username: "bob", password: "password123" });
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.user.username).toBe("bob");
    expect(await new UserRepository(db).getByUsername("bob")).toBeTruthy();
  });

  it("refuses registration when disabled", async () => {
    const db = await freshDb();
    stubSettings({ registration_enabled: false });
    const svc = new AuthService(
      new UserRepository(db),
      new EmailVerificationRepository(db)
    );
    await expect(
      svc.register({ username: "bob", password: "password123" })
    ).rejects.toThrow(/未开放注册/);
  });

  it("enforces email domain whitelist", async () => {
    const db = await freshDb();
    stubSettings({
      registration_enabled: true,
      email_domain_whitelist: ["company.com"],
    });
    const svc = new AuthService(
      new UserRepository(db),
      new EmailVerificationRepository(db)
    );
    await expect(
      svc.register({
        username: "bob",
        password: "password123",
        email: "bob@other.com",
      })
    ).rejects.toThrow(/域名/);
  });

  it("rejects registration with an email already in use (clean 400, not 500)", async () => {
    const db = await freshDb();
    stubSettings({ registration_enabled: true });
    const users = new UserRepository(db);
    const svc = new AuthService(users, new EmailVerificationRepository(db));
    await svc.register({
      username: "alice",
      password: "password123",
      email: "alice@example.com",
    });
    // The users.email UNIQUE constraint must not surface as an INTERNAL error.
    await expect(
      svc.register({
        username: "alice2",
        password: "password123",
        email: "alice@example.com",
      })
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("issues a code, defers account creation, then verifies", async () => {
    const db = await freshDb();
    stubSettings({
      registration_enabled: true,
      email_verification_required: true,
    });
    const sent: { to: string; text: string }[] = [];
    vi.spyOn(mailer, "sendMail").mockImplementation(async (m) => {
      sent.push({ to: m.to, text: m.text });
    });
    const users = new UserRepository(db);
    const verifications = new EmailVerificationRepository(db);
    const svc = new AuthService(users, verifications);

    const pending = await svc.register({
      username: "carol",
      password: "password123",
      email: "carol@x.io",
    });
    expect(pending.status).toBe("verification_required");
    // Account not created yet.
    expect(await users.getByUsername("carol")).toBeUndefined();
    expect(sent).toHaveLength(1);

    const code = sent[0].text.match(/\d{6}/)![0];
    const ok = await svc.verifyEmail("carol@x.io", code);
    expect(ok.status).toBe("ok");
    expect((await users.getByUsername("carol"))?.email).toBe("carol@x.io");

    // Code is single-use.
    await expect(svc.verifyEmail("carol@x.io", code)).rejects.toThrow(
      /无效或已过期/
    );
  });

  it("rejects a wrong verification code", async () => {
    const db = await freshDb();
    const verifications = new EmailVerificationRepository(db);
    await verifications.issue(
      "d@x.io",
      "111111",
      JSON.stringify({ username: "d", password_hash: "h" }),
      60000
    );
    const svc = new AuthService(new UserRepository(db), verifications);
    await expect(svc.verifyEmail("d@x.io", "999999")).rejects.toThrow(
      /无效或已过期/
    );
  });
});
