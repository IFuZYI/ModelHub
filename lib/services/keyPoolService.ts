import { getDatabase } from "../infra/db";
import { KeyPoolRepository, type PoolKey } from "../infra/repositories/keyPoolRepo";
import { SettingsRepository } from "../infra/repositories/settingsRepo";
import { normalizeBaseUrl, type CatalogSlugs } from "../domain/provider";
import type { Role } from "../domain/user";
import { decrypt } from "../infra/crypto";
import { probeModels, type ProbeResult } from "./probe";
import { logger } from "../infra/logger";

/**
 * Shared key pool orchestration (ADR-0011). Keys are contributed automatically
 * when a user saves a provider with a key; consumption is gated by two global
 * settings and only ever used to probe model lists.
 */
export class KeyPoolService {
  private readonly pool: KeyPoolRepository;
  private readonly settings: SettingsRepository;
  constructor(
    pool: KeyPoolRepository = new KeyPoolRepository(getDatabase()),
    settings: SettingsRepository = new SettingsRepository(getDatabase())
  ) {
    this.pool = pool;
    this.settings = settings;
  }

  /** Contribute (or update) a user's key for a base_url. */
  async contribute(
    baseUrl: string,
    userId: string,
    plainKey: string
  ): Promise<void> {
    await this.pool.put(normalizeBaseUrl(baseUrl), userId, plainKey);
  }

  /** Remove a user's contributed key for a base_url (e.g. key cleared). */
  async withdraw(baseUrl: string, userId: string): Promise<void> {
    await this.pool.removeForContributorUrl(normalizeBaseUrl(baseUrl), userId);
  }

  private async canConsume(role: Role): Promise<boolean> {
    const enabled = await this.settings.get("key_share_enabled", false);
    if (!enabled) return false;
    const consumers = await this.settings.get<"admin" | "everyone">(
      "key_share_consumers",
      "admin"
    );
    return consumers === "everyone" || role === "admin";
  }

  /** Randomly pick one usable pooled key for a url, or null. */
  private pickRandom(keys: PoolKey[]): PoolKey | null {
    const usable = keys.filter((k) => k.status !== "invalid");
    if (usable.length === 0) return null;
    return usable[Math.floor(Math.random() * usable.length)];
  }

  /**
   * Probe a provider's models. Tries the owner's own key first; if that is
   * absent/unusable and sharing permits, borrows a pooled key. On a borrowed
   * key's deterministic auth failure, records it and deletes after 2 strikes.
   */
  async probeWithPool(args: {
    adapter: string;
    baseUrl: string;
    catalogSlugs: CatalogSlugs;
    ownKey: string | null;
    consumerRole: Role;
  }): Promise<ProbeResult> {
    // 1. Own key (or a legitimate no-key probe).
    const own = await probeModels({
      adapter: args.adapter,
      baseUrl: args.baseUrl,
      key: args.ownKey,
      catalogSlugs: args.catalogSlugs,
    });
    if (own.status === "ok" || args.ownKey) return own;
    if (own.status !== "needs_key") return own;

    // 2. Borrow from the pool when sharing allows it.
    if (!(await this.canConsume(args.consumerRole))) return own;
    const normalized = normalizeBaseUrl(args.baseUrl);
    const candidates = await this.pool.listForUrl(normalized, true);
    const picked = this.pickRandom(candidates);
    if (!picked) return own;

    let plain: string;
    try {
      plain = decrypt(picked.key_enc);
    } catch {
      // Undecryptable pooled key (master key rotated) — drop it.
      await this.pool.removeById(picked.id);
      return own;
    }

    const borrowed = await probeModels({
      adapter: args.adapter,
      baseUrl: args.baseUrl,
      key: plain,
      catalogSlugs: args.catalogSlugs,
    });
    if (borrowed.status === "ok") {
      await this.pool.markValid(picked.id);
      return borrowed;
    }
    if (borrowed.authFailed) {
      const deleted = await this.pool.recordFailureAndMaybeDelete(picked.id);
      logger.warn(
        { url: normalized, deleted },
        "pooled key auth failure recorded"
      );
    }
    // A borrowed key that didn't work leaves the provider needing its own key.
    return own;
  }
}

export const keyPoolService = new KeyPoolService();
