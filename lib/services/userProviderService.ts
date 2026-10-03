import { randomUUID } from "crypto";
import { AppError } from "../domain/errors";
import {
  normalizeBaseUrl,
  DEFAULT_ADAPTER,
  buildInviteUrl,
  type ProviderType,
  type FreeTier,
  type CatalogSlugs,
} from "../domain/provider";
import type { EncryptedValue } from "../infra/crypto";
import { encrypt } from "../infra/crypto";
import { getDatabase } from "../infra/db";
import {
  UserProviderRepository,
  type OwnedProvider,
  type OwnedProviderMeta,
} from "../infra/repositories/userProviderRepo";
import { UserRepository } from "../infra/repositories/userRepo";
import { TagRepository } from "../infra/repositories/tagRepo";
import { keyPoolService, KeyPoolService } from "./keyPoolService";
import { statsService, StatsService } from "./statsService";
import type { Role } from "../domain/user";

/** Client-safe view of a user's provider (no key material). */
export interface UserProviderView {
  id: string;
  name: string;
  description: string | null;
  type: ProviderType;
  base_url: string;
  free_tier: FreeTier;
  icon: string | null;
  aff_code: string | null;
  adapter: string;
  catalog_slugs: CatalogSlugs;
  has_key: boolean;
  manual_models: boolean;
  register_methods: string[];
  invite_url: string | null;
  model_count: number;
  last_status: OwnedProvider["last_status"];
  last_error: string | null;
  last_fetched: string | null;
  updated_at: string | null;
  /** Custom tags (blog taxonomy). */
  tags: { slug: string; name: string }[];
}

function toView(p: OwnedProvider, tags: { slug: string; name: string }[] = []): UserProviderView {
  return metaToView({ ...p, model_count: p.models.length }, tags);
}

/** Build a view from the count-only meta projection (no model-name blob). */
function metaToView(
  p: OwnedProviderMeta,
  tags: { slug: string; name: string }[] = []
): UserProviderView {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    type: p.type,
    base_url: p.base_url,
    free_tier: p.free_tier,
    icon: p.icon,
    aff_code: p.aff_code,
    adapter: p.adapter,
    catalog_slugs: p.catalog_slugs,
    has_key: p.key_enc !== null,
    manual_models: p.manual_models,
    register_methods: p.register_methods,
    invite_url: buildInviteUrl(p.base_url, p.aff_code),
    model_count: p.model_count,
    last_status: p.last_status,
    last_error: p.last_error,
    last_fetched: p.last_fetched,
    updated_at: p.updated_at,
    tags,
  };
}

export interface CreateUserProviderInput {
  name: string;
  description?: string | null;
  type: ProviderType;
  base_url: string;
  free_tier?: FreeTier;
  icon?: string | null;
  aff_code?: string | null;
  adapter?: string;
  catalog_slugs?: CatalogSlugs;
  key?: string;
  models?: string[];
  manual_models?: boolean;
  register_methods?: string[];
  /** Custom tag names; resolved/created in the global vocabulary. */
  tags?: string[];
}

export type UpdateUserProviderInput = Partial<CreateUserProviderInput>;

function orNull(v: string | null | undefined): string | null {
  return v ? v : null;
}

/**
 * Per-user provider use-cases (ADR-0010). Enforces one-URL-per-user, syncs the
 * key pool and the global stats table on every mutation, and probes models via
 * the owner's key with a pool fallback.
 */
export class UserProviderService {
  private readonly repo: UserProviderRepository;
  private readonly users: UserRepository;
  private readonly pool: KeyPoolService;
  private readonly stats: StatsService;
  private readonly tags: TagRepository;
  constructor(
    repo = new UserProviderRepository(getDatabase()),
    users = new UserRepository(getDatabase()),
    pool: KeyPoolService = keyPoolService,
    stats: StatsService = statsService,
    tags = new TagRepository(getDatabase())
  ) {
    this.repo = repo;
    this.users = users;
    this.pool = pool;
    this.stats = stats;
    this.tags = tags;
  }

  /** Tag views ({slug,name}) for many providers, bulk. */
  private async tagViews(
    providerIds: string[]
  ): Promise<Map<string, { slug: string; name: string }[]>> {
    const byId = await this.tags.tagsForProviders(providerIds);
    const out = new Map<string, { slug: string; name: string }[]>();
    for (const [id, list] of byId) {
      out.set(
        id,
        list.map((t) => ({ slug: t.slug, name: t.name }))
      );
    }
    return out;
  }

  async listByUser(userId: string): Promise<UserProviderView[]> {
    const metas = await this.repo.listMetaByUser(userId);
    const tagsBy = await this.tagViews(metas.map((m) => m.id));
    return metas.map((m) => metaToView(m, tagsBy.get(m.id) ?? []));
  }

  async getOwned(userId: string, id: string): Promise<OwnedProvider> {
    const p = await this.repo.getById(id);
    if (!p || p.user_id !== userId) throw AppError.notFound("Provider not found");
    return p;
  }

  async create(
    userId: string,
    role: Role,
    input: CreateUserProviderInput
  ): Promise<UserProviderView> {
    const normalized = normalizeBaseUrl(input.base_url);
    if (await this.repo.getByUserAndUrl(userId, input.base_url)) {
      throw AppError.validation("你已配置过该提供商（URL 重复）");
    }
    const keyEnc: EncryptedValue | null = input.key ? encrypt(input.key) : null;
    const owned: OwnedProvider = {
      id: randomUUID(),
      user_id: userId,
      name: input.name,
      description: orNull(input.description),
      type: input.type,
      base_url: input.base_url,
      aff_code: orNull(input.aff_code),
      adapter: input.adapter || DEFAULT_ADAPTER,
      free_tier: input.free_tier ?? "none",
      catalog_slugs: input.catalog_slugs ?? {},
      key_enc: keyEnc,
      manual_models: input.manual_models ?? false,
      icon: orNull(input.icon),
      register_methods: input.register_methods ?? [],
      models: input.models ? [...input.models].sort() : [],
      last_fetched: null,
      last_status: "pending",
      last_error: null,
      updated_at: null,
    };
    await this.repo.upsert(owned);
    if (input.key) await this.pool.contribute(input.base_url, userId, input.key);
    if (input.tags && input.tags.length > 0) {
      await this.tags.replaceProviderTags(owned.id, input.tags);
    }
    const refreshed = await this.probeAndPersist(owned, role);
    await this.stats.recompute(normalized);
    const tagsBy = await this.tagViews([refreshed.id]);
    return toView(refreshed, tagsBy.get(refreshed.id) ?? []);
  }

  async update(
    userId: string,
    role: Role,
    id: string,
    input: UpdateUserProviderInput
  ): Promise<UserProviderView> {
    const existing = await this.getOwned(userId, id);
    const prevNormalized = normalizeBaseUrl(existing.base_url);
    const updated: OwnedProvider = { ...existing };

    if (input.name !== undefined) updated.name = input.name;
    if (input.description !== undefined) updated.description = orNull(input.description);
    if (input.type !== undefined) updated.type = input.type;
    if (input.base_url !== undefined) {
      // Changing URL must not collide with another of the user's providers.
      const clash = await this.repo.getByUserAndUrl(userId, input.base_url);
      if (clash && clash.id !== id) {
        throw AppError.validation("你已配置过该提供商（URL 重复）");
      }
      updated.base_url = input.base_url;
    }
    if (input.free_tier !== undefined) updated.free_tier = input.free_tier;
    if (input.icon !== undefined) updated.icon = orNull(input.icon);
    if (input.aff_code !== undefined) updated.aff_code = orNull(input.aff_code);
    if (input.adapter !== undefined) updated.adapter = input.adapter || DEFAULT_ADAPTER;
    if (input.catalog_slugs !== undefined) updated.catalog_slugs = input.catalog_slugs;
    if (input.register_methods !== undefined)
      updated.register_methods = input.register_methods;
    if (input.manual_models !== undefined) updated.manual_models = input.manual_models;
    if (input.models !== undefined) updated.models = [...input.models].sort();

    let keyChanged = false;
    if (input.key !== undefined) {
      updated.key_enc = input.key ? encrypt(input.key) : null;
      keyChanged = true;
    }

    await this.repo.upsert(updated);

    // Sync key pool: contribution follows the current key + url.
    const newNormalized = normalizeBaseUrl(updated.base_url);
    if (keyChanged || input.base_url !== undefined) {
      if (prevNormalized !== newNormalized) {
        await this.pool.withdraw(existing.base_url, userId);
      }
      if (input.key) {
        await this.pool.contribute(updated.base_url, userId, input.key);
      } else if (keyChanged && !input.key) {
        await this.pool.withdraw(updated.base_url, userId);
      }
    }

    // Replace tags when provided (single-transaction resolve+attach+prune).
    if (input.tags !== undefined) {
      await this.tags.replaceProviderTags(id, input.tags);
    }

    const refreshed = await this.probeAndPersist(updated, role);
    if (prevNormalized !== newNormalized) await this.stats.recompute(prevNormalized);
    await this.stats.recompute(newNormalized);
    const tagsBy = await this.tagViews([refreshed.id]);
    return toView(refreshed, tagsBy.get(refreshed.id) ?? []);
  }

  async remove(userId: string, id: string): Promise<void> {
    const existing = await this.getOwned(userId, id);
    await this.repo.remove(id);
    await this.pool.withdraw(existing.base_url, userId);
    // Lock-guarded: a bare prune statement can deadlock with a concurrent
    // writer's create+attach transaction (FK KEY SHARE vs DELETE).
    await this.tags.pruneWithLock();
    await this.stats.recompute(normalizeBaseUrl(existing.base_url));
  }

  async refresh(userId: string, role: Role, id: string): Promise<UserProviderView> {
    const existing = await this.getOwned(userId, id);
    const refreshed = await this.probeAndPersist(existing, role);
    const tagsBy = await this.tagViews([refreshed.id]);
    return toView(refreshed, tagsBy.get(refreshed.id) ?? []);
  }

  /**
   * Refresh every user's providers with bounded concurrency (scheduler use).
   * Each provider probes with its owner's key + pool per the owner's role.
   */
  async refreshAll(concurrency = 4): Promise<number> {
    const all = await this.repo.listAll();
    const roleById = new Map(
      (await this.users.list()).map((u) => [u.id, u.role])
    );
    const queue = [...all];
    async function worker(self: UserProviderService) {
      for (;;) {
        const p = queue.shift();
        if (!p) return;
        const role = roleById.get(p.user_id) ?? "user";
        await self.probeAndPersist(p, role).catch(() => undefined);
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(concurrency, all.length || 1) }, () =>
        worker(this)
      )
    );
    return all.length;
  }

  /** Probe models (own key → pool) and persist the resulting cache. */
  private async probeAndPersist(
    provider: OwnedProvider,
    role: Role
  ): Promise<OwnedProvider> {
    const now = new Date().toISOString();
    if (provider.manual_models) {
      const seeded: OwnedProvider = {
        ...provider,
        last_fetched: now,
        last_status: provider.models.length > 0 ? "ok" : "pending",
        last_error: null,
        updated_at: now,
      };
      await this.repo.upsert(seeded);
      return seeded;
    }
    const ownKey = provider.key_enc
      ? (await import("../infra/crypto")).decrypt(provider.key_enc)
      : null;
    const result = await this.pool.probeWithPool({
      adapter: provider.adapter,
      baseUrl: provider.base_url,
      catalogSlugs: provider.catalog_slugs,
      ownKey,
      consumerRole: role,
    });
    const next: OwnedProvider = {
      ...provider,
      models: result.status === "ok" ? result.models : provider.models,
      last_fetched: now,
      last_status: result.status,
      last_error: result.error,
      updated_at: result.status === "ok" ? now : provider.updated_at,
    };
    await this.repo.upsert(next);
    return next;
  }
}

export const userProviderService = new UserProviderService();
