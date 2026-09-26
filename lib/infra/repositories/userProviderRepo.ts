import type { Kysely } from "kysely";
import type { DatabaseSchema } from "../db";
import {
  StoredProvider,
  normalizeBaseUrl,
  type ProviderType,
  type FreeTier,
  type CatalogSlugs,
  type FetchStatus,
} from "../../domain/provider";
import type { EncryptedValue } from "../crypto";

type ProviderRow = DatabaseSchema["user_providers"];
type CacheRow = DatabaseSchema["model_caches"];

/** A StoredProvider plus the id of the user who owns this mount (ADR-0010). */
export interface OwnedProvider extends StoredProvider {
  user_id: string;
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function compose(row: ProviderRow, cache: CacheRow | undefined): OwnedProvider {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    description: row.description,
    type: row.type as ProviderType,
    base_url: row.base_url,
    aff_code: row.aff_code,
    adapter: row.adapter,
    free_tier: row.free_tier as FreeTier,
    catalog_slugs: parseJson<CatalogSlugs>(row.catalog_slugs, {}),
    key_enc: parseJson<EncryptedValue | null>(row.key_enc, null),
    manual_models: row.manual_models === 1,
    icon: row.icon,
    register_methods: parseJson<string[]>(row.register_methods, []),
    models: cache ? parseJson<string[]>(cache.models, []) : [],
    last_fetched: cache?.last_fetched ?? null,
    last_status: (cache?.last_status ?? "pending") as FetchStatus,
    last_error: cache?.last_error ?? null,
    updated_at: cache?.updated_at ?? null,
  };
}

function toProviderRow(p: OwnedProvider): ProviderRow {
  return {
    id: p.id,
    user_id: p.user_id,
    name: p.name,
    description: p.description,
    type: p.type,
    base_url: p.base_url,
    normalized_base_url: normalizeBaseUrl(p.base_url),
    free_tier: p.free_tier,
    icon: p.icon,
    adapter: p.adapter,
    aff_code: p.aff_code,
    catalog_slugs: JSON.stringify(p.catalog_slugs ?? {}),
    key_enc: p.key_enc ? JSON.stringify(p.key_enc) : null,
    manual_models: p.manual_models ? 1 : 0,
    register_methods: JSON.stringify(p.register_methods ?? []),
  };
}

function toCacheRow(p: OwnedProvider): CacheRow {
  return {
    user_provider_id: p.id,
    models: JSON.stringify(p.models ?? []),
    count: p.models?.length ?? 0,
    last_fetched: p.last_fetched,
    last_status: p.last_status,
    last_error: p.last_error,
    updated_at: p.updated_at,
  };
}

/**
 * Persistence for per-user provider mounts + their model caches (ADR-0010).
 * A provider row carries identity/connection/key; a model_caches row carries
 * that user's fetched model list, kept separate so refreshes don't rewrite
 * config. `(user_id, normalized_base_url)` is unique at the DB level.
 */
export class UserProviderRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  private async cacheFor(id: string): Promise<CacheRow | undefined> {
    return this.db
      .selectFrom("model_caches")
      .selectAll()
      .where("user_provider_id", "=", id)
      .executeTakeFirst();
  }

  async listByUser(userId: string): Promise<OwnedProvider[]> {
    const rows = await this.db
      .selectFrom("user_providers")
      .selectAll()
      .where("user_id", "=", userId)
      .execute();
    const caches = await this.db
      .selectFrom("model_caches")
      .selectAll()
      .where(
        "user_provider_id",
        "in",
        rows.length ? rows.map((r) => r.id) : ["__none__"]
      )
      .execute();
    const byId = new Map(caches.map((c) => [c.user_provider_id, c]));
    return rows.map((r) => compose(r, byId.get(r.id)));
  }

  async listAll(): Promise<OwnedProvider[]> {
    const rows = await this.db.selectFrom("user_providers").selectAll().execute();
    const caches = await this.db.selectFrom("model_caches").selectAll().execute();
    const byId = new Map(caches.map((c) => [c.user_provider_id, c]));
    return rows.map((r) => compose(r, byId.get(r.id)));
  }

  async getById(id: string): Promise<OwnedProvider | undefined> {
    const row = await this.db
      .selectFrom("user_providers")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    if (!row) return undefined;
    return compose(row, await this.cacheFor(id));
  }

  /** Find a user's mount for a given base_url (compared by normalized form). */
  async getByUserAndUrl(
    userId: string,
    baseUrl: string
  ): Promise<OwnedProvider | undefined> {
    const row = await this.db
      .selectFrom("user_providers")
      .selectAll()
      .where("user_id", "=", userId)
      .where("normalized_base_url", "=", normalizeBaseUrl(baseUrl))
      .executeTakeFirst();
    if (!row) return undefined;
    return compose(row, await this.cacheFor(row.id));
  }

  /** Insert or update a mount + its cache in one transaction. */
  async upsert(provider: OwnedProvider): Promise<void> {
    const providerRow = toProviderRow(provider);
    const cacheRow = toCacheRow(provider);
    await this.db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom("user_providers")
        .select("id")
        .where("id", "=", provider.id)
        .executeTakeFirst();
      if (existing) {
        const { id: _id, ...set } = providerRow;
        void _id;
        await trx
          .updateTable("user_providers")
          .set(set)
          .where("id", "=", provider.id)
          .execute();
      } else {
        await trx.insertInto("user_providers").values(providerRow).execute();
      }
      const cacheExists = await trx
        .selectFrom("model_caches")
        .select("user_provider_id")
        .where("user_provider_id", "=", provider.id)
        .executeTakeFirst();
      if (cacheExists) {
        const { user_provider_id: _pid, ...set } = cacheRow;
        void _pid;
        await trx
          .updateTable("model_caches")
          .set(set)
          .where("user_provider_id", "=", provider.id)
          .execute();
      } else {
        await trx.insertInto("model_caches").values(cacheRow).execute();
      }
    });
  }

  async remove(id: string): Promise<boolean> {
    const res = await this.db
      .deleteFrom("user_providers")
      .where("id", "=", id)
      .executeTakeFirst();
    // model_caches cascades via FK.
    return Number(res.numDeletedRows ?? 0) > 0;
  }
}
