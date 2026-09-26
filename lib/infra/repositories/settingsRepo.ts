import type { Kysely } from "kysely";
import type { DatabaseSchema } from "../db";
import { encrypt, decrypt, type EncryptedValue } from "../crypto";

/**
 * Key-value system settings (ADR-0012). Values are stored as JSON strings.
 * Sensitive values (e.g. SMTP password) are encrypted at rest via AES-256-GCM
 * and exposed through the *secret* helpers only.
 */
export class SettingsRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async getRaw(key: string): Promise<string | undefined> {
    const row = await this.db
      .selectFrom("settings")
      .select("value")
      .where("key", "=", key)
      .executeTakeFirst();
    return row?.value;
  }

  async setRaw(key: string, value: string): Promise<void> {
    const existing = await this.db
      .selectFrom("settings")
      .select("key")
      .where("key", "=", key)
      .executeTakeFirst();
    if (existing) {
      await this.db
        .updateTable("settings")
        .set({ value })
        .where("key", "=", key)
        .execute();
    } else {
      await this.db.insertInto("settings").values({ key, value }).execute();
    }
  }

  async get<T>(key: string, fallback: T): Promise<T> {
    const raw = await this.getRaw(key);
    if (raw === undefined) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.setRaw(key, JSON.stringify(value));
  }

  /** Store a secret string encrypted at rest. Empty/undefined clears the key. */
  async setSecret(key: string, plain: string | null | undefined): Promise<void> {
    if (!plain) {
      await this.db.deleteFrom("settings").where("key", "=", key).execute();
      return;
    }
    await this.setRaw(key, JSON.stringify(encrypt(plain)));
  }

  /** Retrieve and decrypt a secret string, or null when unset/corrupt. */
  async getSecret(key: string): Promise<string | null> {
    const raw = await this.getRaw(key);
    if (!raw) return null;
    try {
      return decrypt(JSON.parse(raw) as EncryptedValue);
    } catch {
      return null;
    }
  }

  async all(): Promise<Record<string, string>> {
    const rows = await this.db.selectFrom("settings").selectAll().execute();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }
}
