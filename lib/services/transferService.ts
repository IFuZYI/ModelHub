import { z } from "zod";
import { sql, type Kysely } from "kysely";
import type { DatabaseSchema } from "../infra/db";
import { getDatabase } from "../infra/db";
import { AppError } from "../domain/errors";
import { encrypt, decrypt, type EncryptedValue } from "../infra/crypto";
import { logger } from "../infra/logger";

/**
 * Full-database export/import for server migration (ADR-0014).
 *
 * A server move must carry every piece of user-owned data — accounts (with
 * their password hashes, so nobody has to reset), providers, model caches,
 * tags, ratings, comments, profiles, admin stats overrides and settings.
 *
 * Secrets are the subtle part. Provider API keys, key-pool entries and the
 * SMTP password are AES-256-GCM encrypted with THIS server's
 * MODELHUB_MASTER_KEY, so copying the ciphertext to a server with a different
 * key produces rows that decrypt to garbage. Export therefore offers:
 *   - includeSecrets: false (default) — key material is dropped entirely.
 *   - includeSecrets: true            — secrets are decrypted into a separate
 *     `key_plain` / `value` field so the target re-encrypts them with its own
 *     master key. The resulting file is sensitive and must be handled as such.
 *
 * provider_stats is exported too: its admin_* override columns are authored
 * data and cannot be recomputed from providers alone.
 */

export const TRANSFER_FORMAT = "modelhub-export";
export const TRANSFER_VERSION = 1;

/** Table names in dependency order: parents before children. */
const INSERT_ORDER = [
  "users",
  "user_profiles",
  "tags",
  "user_providers",
  "model_caches",
  "provider_tags",
  "ratings",
  "comments",
  "provider_stats",
  "key_pool",
  "invite_codes",
  "settings",
] as const;

type TableName = (typeof INSERT_ORDER)[number];

/** Primary key per table (null = composite, handled row-wise). */
const PRIMARY_KEY: Record<TableName, string | null> = {
  users: "id",
  user_profiles: "user_id",
  tags: "id",
  user_providers: "id",
  model_caches: "user_provider_id",
  provider_tags: null, // composite (user_provider_id, tag_id)
  ratings: "id",
  comments: "id",
  provider_stats: "normalized_base_url",
  key_pool: "id",
  invite_codes: "id",
  settings: "key",
};

export interface ExportOptions {
  /** Decrypt key material so a target server can re-encrypt it. */
  includeSecrets: boolean;
}

export interface ExportBundle {
  format: typeof TRANSFER_FORMAT;
  version: number;
  exported_at: string;
  counts: Record<string, number>;
  includes_secrets: boolean;
  data: Record<string, unknown[]>;
}

export interface ImportOptions {
  /** merge = upsert by primary key; replace = wipe these tables, then insert. */
  mode: "merge" | "replace";
}

/**
 * Natural (unique) keys besides the primary key. A fresh server bootstraps its
 * own admin, so an imported bundle almost always carries a DIFFERENT id for
 * the same username — inserting blindly violates the unique index. When an
 * incoming row collides on one of these, we adopt the existing row's id and
 * re-point child rows at it instead of failing the whole migration.
 *
 * Every UNIQUE constraint in the schema must be covered here or by
 * COMPOSITE_KEYS, otherwise an insert can still collide on a key the upsert
 * never checked (e.g. ratings are unique per (provider, user)).
 */
const NATURAL_KEYS: Partial<Record<TableName, string[]>> = {
  users: ["username", "email", "slug"],
  tags: ["slug"],
  settings: ["key"],
};

/** Composite unique keys, matched as a whole tuple (never column-by-column). */
const COMPOSITE_KEYS: Partial<Record<TableName, string[][]>> = {
  // A user may only mount one provider per normalized url.
  user_providers: [["user_id", "normalized_base_url"]],
  // One rating per (provider, user).
  ratings: [["user_provider_id", "user_id"]],
  // One pool key per (url, contributor).
  key_pool: [["normalized_base_url", "contributor_user_id"]],
  // A code is unique per site.
  invite_codes: [["normalized_base_url", "code"]],
};

export interface ImportSummary {
  mode: ImportOptions["mode"];
  imported: Record<string, number>;
  /** Rows skipped because a required parent row was absent. */
  skipped: number;
  /**
   * Incoming rows merged onto an existing row that shared a natural key
   * (username / email / slug / base_url) under a different id. Child rows were
   * re-pointed at the surviving id.
   */
  remapped: number;
}

const SECRET_SETTING_KEYS = new Set(["smtp_password"]);

/** Attempt to decrypt a stored secret; null when absent or unreadable. */
function tryDecrypt(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    return decrypt(JSON.parse(raw) as EncryptedValue);
  } catch {
    // Encrypted with a different master key, or corrupt: treat as absent
    // rather than failing the whole export.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Import validation
// ---------------------------------------------------------------------------

const bundleSchema = z.object({
  format: z.literal(TRANSFER_FORMAT),
  version: z.number().int().positive(),
  exported_at: z.string().optional(),
  counts: z.record(z.string(), z.number()).optional(),
  includes_secrets: z.boolean().optional(),
  data: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
});

/** Minimal per-table required fields, checked before touching the DB. */
const REQUIRED: Record<TableName, string[]> = {
  users: ["id", "username", "password_hash", "role", "status"],
  user_profiles: ["user_id", "updated_at"],
  tags: ["id", "slug", "name", "created_at"],
  user_providers: [
    "id",
    "user_id",
    "name",
    "type",
    "base_url",
    "normalized_base_url",
    "free_tier",
    "adapter",
    "manual_models",
  ],
  model_caches: ["user_provider_id", "models", "count", "last_status"],
  provider_tags: ["user_provider_id", "tag_id"],
  ratings: [
    "id",
    "user_provider_id",
    "user_id",
    "score",
    "created_at",
    "updated_at",
  ],
  comments: [
    "id",
    "user_provider_id",
    "user_id",
    "body",
    "created_at",
    "updated_at",
  ],
  provider_stats: ["normalized_base_url", "base_url", "updated_at"],
  key_pool: [
    "id",
    "normalized_base_url",
    "contributor_user_id",
    "status",
    "fail_count",
    "updated_at",
  ],
  invite_codes: ["id", "code", "normalized_base_url", "created_at"],
  settings: ["key", "value"],
};

function assertRows(table: TableName, list: Record<string, unknown>[]): void {
  for (let i = 0; i < list.length; i++) {
    const row = list[i];
    for (const field of REQUIRED[table]) {
      if (row[field] === undefined || row[field] === null) {
        throw AppError.validation(
          `导入文件损坏：${table} 第 ${i + 1} 行缺少字段 ${field}`
        );
      }
    }
  }
}

/** Keep only columns the target schema actually has, so a newer export with
 * extra fields still imports (forward compatibility). */
async function schemaColumns(
  db: Kysely<DatabaseSchema>,
  table: TableName
): Promise<Set<string>> {
  const cols = await db.introspection.getTables();
  const found = cols.find((t) => t.name === table);
  return new Set((found?.columns ?? []).map((c) => c.name));
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class TransferService {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  /** Snapshot the whole database into a portable bundle. */
  async export(options: ExportOptions): Promise<ExportBundle> {
    const data: Record<string, unknown[]> = {};
    for (const table of INSERT_ORDER) {
      data[table] = (await this.db
        .selectFrom(table)
        .selectAll()
        .execute()) as unknown[];
    }

    for (const row of data.user_providers as Record<string, unknown>[]) {
      if (options.includeSecrets) {
        row.key_plain = tryDecrypt(row.key_enc);
      }
      row.key_enc = null;
    }
    // A key-pool entry IS its key: without the secret it carries nothing worth
    // migrating, so drop those rows entirely rather than importing dead rows.
    data.key_pool = (data.key_pool as Record<string, unknown>[]).flatMap((row) => {
      if (!options.includeSecrets) return [];
      const plain = tryDecrypt(row.key_enc);
      if (plain === null) return [];
      return [{ ...row, key_enc: null, key_plain: plain }];
    });
    // Settings hold the SMTP password as an encrypted JSON blob. Strip it
    // unless the operator asked for secrets, in which case carry it decrypted
    // under `value` with a marker so import knows to re-encrypt.
    data.settings = (data.settings as Record<string, unknown>[]).flatMap((row) => {
      const key = String(row.key);
      if (!SECRET_SETTING_KEYS.has(key)) return [row];
      if (!options.includeSecrets) return [];
      const plain = tryDecrypt(row.value);
      if (plain === null) return [];
      return [{ key, value: plain, value_plain: true }];
    });

    const counts: Record<string, number> = {};
    for (const [table, list] of Object.entries(data)) counts[table] = list.length;

    logger.info(
      { counts, includeSecrets: options.includeSecrets },
      "database export generated"
    );
    return {
      format: TRANSFER_FORMAT,
      version: TRANSFER_VERSION,
      exported_at: new Date().toISOString(),
      counts,
      includes_secrets: options.includeSecrets,
      data,
    };
  }

  /** Re-encrypt an incoming secret with THIS server's master key. */
  private localSecret(value: unknown): string | null {
    if (typeof value !== "string" || value.length === 0) return null;
    return JSON.stringify(encrypt(value));
  }

  /** Restore a bundle. One transaction, so a failure changes nothing. */
  async import(bundle: unknown, options: ImportOptions): Promise<ImportSummary> {
    const parsed = bundleSchema.safeParse(bundle);
    if (!parsed.success) {
      throw AppError.validation(
        "导入文件格式不正确（应为 ModelHub 导出的 JSON）"
      );
    }
    const file = parsed.data;
    if (file.version > TRANSFER_VERSION) {
      throw AppError.validation(
        `导入文件版本（v${file.version}）高于当前程序（v${TRANSFER_VERSION}），请先升级程序`
      );
    }

    const incoming: Record<TableName, Record<string, unknown>[]> = {} as never;
    for (const table of INSERT_ORDER) {
      const list = file.data[table] ?? [];
      assertRows(table, list);
      incoming[table] = list;
    }

    // Replace mode must not lock the operator out.
    if (options.mode === "replace") {
      const admins = incoming.users.filter(
        (u) => u.role === "admin" && u.status === "active"
      );
      if (admins.length === 0) {
        throw AppError.validation(
          "覆盖导入被拒绝：文件中没有可用的管理员账号，会导致无人能登录"
        );
      }
    }

    const imported: Record<string, number> = {};
    let skipped = 0;
    let remapped = 0;

    await this.db.transaction().execute(async (trx) => {
      // Columns per table, so unknown fields from a newer export are dropped
      // instead of breaking the insert.
      const columns: Record<string, Set<string>> = {};
      for (const table of INSERT_ORDER) {
        columns[table] = await schemaColumns(trx, table);
      }

      const insertRow = async (
        table: TableName,
        row: Record<string, unknown>
      ): Promise<void> => {
        const entries = Object.entries(row).filter(([k]) =>
          columns[table].has(k)
        );
        const cols = entries.map(([k]) => sql.id(k));
        const vals = entries.map(([, v]) => sql.val(v ?? null));
        await sql`
          insert into ${sql.table(table)} (${sql.join(cols)})
          values (${sql.join(vals)})
        `.execute(trx);
      };

      const updateRow = async (
        table: TableName,
        pk: string,
        row: Record<string, unknown>
      ): Promise<void> => {
        const entries = Object.entries(row).filter(
          ([k]) => k !== pk && columns[table].has(k)
        );
        if (entries.length === 0) return;
        const assignments = entries.map(
          ([k, v]) => sql`${sql.id(k)} = ${sql.val(v ?? null)}`
        );
        await sql`
          update ${sql.table(table)} set ${sql.join(assignments)}
          where ${sql.id(pk)} = ${sql.val(row[pk])}
        `.execute(trx);
      };

      const pkFor = (table: TableName): string | null => PRIMARY_KEY[table];

      const rowExists = async (
        table: TableName,
        pk: string,
        value: unknown
      ): Promise<boolean> => {
        const res = await sql<{ n: number }>`
          select count(*) as n from ${sql.table(table)}
          where ${sql.id(pk)} = ${sql.val(value)}
        `.execute(trx);
        return Number(res.rows[0]?.n ?? 0) > 0;
      };

      /**
       * Find an existing row that matches this incoming row on a natural
       * (unique) key, returning its primary-key value. Used to merge an
       * imported row onto the row a fresh server already created for the same
       * username / email / url, instead of colliding on the unique index.
       */
      const findByNaturalKey = async (
        table: TableName,
        row: Record<string, unknown>
      ): Promise<{ pk: string; value: string } | null> => {
        const pk = pkFor(table);
        if (!pk) return null;

        // Single-column unique keys.
        for (const key of NATURAL_KEYS[table] ?? []) {
          const value = row[key];
          // NULLs are never "equal" in a unique index, so ignore them.
          if (value === undefined || value === null || value === "") continue;
          const res = await sql<{ v: unknown }>`
            select ${sql.id(pk)} as v from ${sql.table(table)}
            where ${sql.id(key)} = ${sql.val(value)}
          `.execute(trx);
          const found = res.rows[0]?.v;
          if (found !== undefined && found !== null) {
            return { pk, value: String(found) };
          }
        }

        // Composite unique keys, matched as a whole tuple.
        for (const cols of COMPOSITE_KEYS[table] ?? []) {
          const values = cols.map((c) => row[c]);
          if (values.some((v) => v === undefined || v === null || v === "")) {
            continue;
          }
          const where = cols.map(
            (c, i) => sql`${sql.id(c)} = ${sql.val(values[i])}`
          );
          const res = await sql<{ v: unknown }>`
            select ${sql.id(pk)} as v from ${sql.table(table)}
            where ${sql.join(where, sql` and `)}
          `.execute(trx);
          const found = res.rows[0]?.v;
          if (found !== undefined && found !== null) {
            return { pk, value: String(found) };
          }
        }
        return null;
      };

      /** Remap incoming ids -> surviving ids, per table, for child lookups. */
      const idRemap: Partial<Record<TableName, Map<string, string>>> = {};

      const remapFor = (table: TableName): Map<string, string> => {
        const existing = idRemap[table];
        if (existing) return existing;
        const fresh = new Map<string, string>();
        idRemap[table] = fresh;
        return fresh;
      };

      /**
       * Upsert one row by primary key (merge) or plain insert (replace).
       * On a natural-key collision the incoming row is merged onto the
       * existing one and its old id is recorded so children follow along.
       */
      const upsert = async (
        table: TableName,
        row: Record<string, unknown>
      ): Promise<void> => {
        const pk = pkFor(table);
        if (options.mode === "merge" && pk) {
          if (await rowExists(table, pk, row[pk])) {
            await updateRow(table, pk, row);
            return;
          }
          const natural = await findByNaturalKey(table, row);
          if (natural) {
            // Same real-world entity, different id: adopt the existing row.
            if (String(row[pk]) !== natural.value) {
              remapFor(table).set(String(row[pk]), natural.value);
              remapped++;
            }
            await updateRow(table, natural.pk, { ...row, [natural.pk]: natural.value });
            return;
          }
        }
        await insertRow(table, row);
      };

      /** Resolve an incoming id through any recorded remap. */
      const resolveId = (table: TableName, id: unknown): string => {
        const key = String(id);
        return remapFor(table).get(key) ?? key;
      };

      if (options.mode === "replace") {
        // Children first (reverse dependency order).
        for (const table of [...INSERT_ORDER].reverse()) {
          await sql`delete from ${sql.table(table)}`.execute(trx);
        }
      }

      // Ids that actually exist, so dangling children are skipped rather than
      // violating a foreign key mid-import.
      const userIds = new Set<string>();
      const providerIds = new Set<string>();
      const tagIds = new Set<string>();

      for (const row of incoming.users) {
        await upsert("users", row);
        userIds.add(resolveId("users", row.id));
      }
      imported.users = userIds.size;

      let n = 0;
      for (const row of incoming.user_profiles) {
        const uid = resolveId("users", row.user_id);
        if (!userIds.has(uid)) {
          skipped++;
          continue;
        }
        await upsert("user_profiles", { ...row, user_id: uid });
        n++;
      }
      imported.user_profiles = n;

      for (const row of incoming.tags) {
        await upsert("tags", row);
        tagIds.add(resolveId("tags", row.id));
      }
      imported.tags = tagIds.size;

      n = 0;
      for (const row of incoming.user_providers) {
        const uid = resolveId("users", row.user_id);
        if (!userIds.has(uid)) {
          skipped++;
          continue;
        }
        const values: Record<string, unknown> = { ...row, user_id: uid };
        // A carried plaintext key is re-encrypted with the local master key.
        if (values.key_plain !== undefined) {
          values.key_enc = this.localSecret(values.key_plain);
        }
        delete values.key_plain;
        await upsert("user_providers", values);
        providerIds.add(resolveId("user_providers", values.id));
        n++;
      }
      imported.user_providers = n;

      n = 0;
      for (const row of incoming.model_caches) {
        const pid = resolveId("user_providers", row.user_provider_id);
        if (!providerIds.has(pid)) {
          skipped++;
          continue;
        }
        await upsert("model_caches", { ...row, user_provider_id: pid });
        n++;
      }
      imported.model_caches = n;

      n = 0;
      for (const row of incoming.provider_tags) {
        const pid = resolveId("user_providers", row.user_provider_id);
        const tid = resolveId("tags", row.tag_id);
        if (!providerIds.has(pid) || !tagIds.has(tid)) {
          skipped++;
          continue;
        }
        const exists = await sql<{ n: number }>`
          select count(*) as n from ${sql.table("provider_tags")}
          where ${sql.id("user_provider_id")} = ${sql.val(pid)}
            and ${sql.id("tag_id")} = ${sql.val(tid)}
        `.execute(trx);
        if (Number(exists.rows[0]?.n ?? 0) > 0) {
          n++;
          continue; // composite key: identical row already present
        }
        await insertRow("provider_tags", { user_provider_id: pid, tag_id: tid });
        n++;
      }
      imported.provider_tags = n;

      for (const table of ["ratings", "comments"] as const) {
        n = 0;
        for (const row of incoming[table]) {
          const pid = resolveId("user_providers", row.user_provider_id);
          const uid = resolveId("users", row.user_id);
          if (!providerIds.has(pid) || !userIds.has(uid)) {
            skipped++;
            continue;
          }
          await upsert(table, { ...row, user_provider_id: pid, user_id: uid });
          n++;
        }
        imported[table] = n;
      }

      // provider_stats: admin overrides are authored data, carried as-is.
      n = 0;
      for (const row of incoming.provider_stats) {
        await upsert("provider_stats", row);
        n++;
      }
      imported.provider_stats = n;

      n = 0;
      for (const row of incoming.key_pool) {
        const uid = resolveId("users", row.contributor_user_id);
        if (!userIds.has(uid)) {
          skipped++;
          continue;
        }
        const values: Record<string, unknown> = { ...row, contributor_user_id: uid };
        if (values.key_plain !== undefined) {
          values.key_enc = this.localSecret(values.key_plain);
        }
        delete values.key_plain;
        if (!values.key_enc) {
          skipped++; // no usable key material for this entry
          continue;
        }
        await upsert("key_pool", values);
        n++;
      }
      imported.key_pool = n;

      // invite_codes: admin-registered pool codes (no parent rows to resolve).
      n = 0;
      for (const row of incoming.invite_codes) {
        await upsert("invite_codes", row);
        n++;
      }
      imported.invite_codes = n;

      n = 0;
      for (const row of incoming.settings) {
        const key = String(row.key);
        let value = row.value;
        if (SECRET_SETTING_KEYS.has(key)) {
          // Plaintext secret from the file: encrypt with the local key.
          if (row.value_plain === true) {
            const enc = this.localSecret(value);
            if (!enc) {
              skipped++;
              continue;
            }
            value = enc;
          } else if (typeof value === "string" && value.length === 0) {
            // Secret was stripped on export; keep the local value.
            skipped++;
            continue;
          }
        }
        await upsert("settings", { key, value: String(value) });
        n++;
      }
      imported.settings = n;
    });

    logger.info(
      { mode: options.mode, imported, skipped, remapped },
      "database import applied"
    );
    return { mode: options.mode, imported, skipped, remapped };
  }

  /** Row counts for the admin UI, so an operator can see what would move. */
  async summary(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const table of INSERT_ORDER) {
      const res = await this.db
        .selectFrom(table)
        .select((eb) => eb.fn.countAll<number>().as("n"))
        .executeTakeFirst();
      counts[table] = Number(res?.n ?? 0);
    }
    return counts;
  }
}

export const transferService = new TransferService(getDatabase());
