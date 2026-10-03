import { getDatabase } from "../infra/db";
import { InviteCodeRepository } from "../infra/repositories/inviteCodeRepo";
import { UserProviderRepository } from "../infra/repositories/userProviderRepo";
import { normalizeBaseUrl } from "../domain/provider";
import { AppError } from "../domain/errors";
import { logger } from "../infra/logger";

/**
 * Platform invite-code pool (ADR-0015).
 *
 * A code's source is the UNION of two places, which is what makes the pool
 * self-populating:
 *   1. codes users typed into their own provider mounts (`aff_code`), and
 *   2. codes an admin registered directly here.
 *
 * Resolution happens per (site, provider) at render time: a provider whose
 * aff_code is the RANDOM sentinel — or blank while the blank-policy setting is
 * "random" — draws one eligible code. Codes are always scoped to the site's
 * normalized base_url, because a referral code only works on its own relay.
 */

/** One drawable code plus where it came from, for the admin UI. */
export interface PoolCode {
  code: string;
  /** "user" = typed on a provider mount; "admin" = registered in the pool. */
  source: "user" | "admin";
  /** Provider id / pool row id, for removal. Null for user-sourced codes. */
  id: string | null;
  /** Owning provider name or pool note, for context. */
  label: string | null;
}

/** A site's pool, as shown in the admin UI. */
export interface SitePool {
  normalized_base_url: string;
  base_url: string;
  codes: PoolCode[];
}

export class InviteCodeService {
  private readonly pool: InviteCodeRepository;
  private readonly providers: UserProviderRepository;

  constructor(
    pool = new InviteCodeRepository(getDatabase()),
    providers = new UserProviderRepository(getDatabase())
  ) {
    this.pool = pool;
    this.providers = providers;
  }

  /**
   * Every drawable code for one site: the users' aff codes plus the
   * admin-registered ones, de-duplicated by code string (a code typed by a
   * user AND registered by an admin appears once).
   */
  async codesForUrl(normalizedBaseUrl: string): Promise<PoolCode[]> {
    const [owned, registered] = await Promise.all([
      this.providers.listMetaByNormalizedUrl(normalizedBaseUrl),
      this.pool.listForUrl(normalizedBaseUrl),
    ]);

    const byCode = new Map<string, PoolCode>();
    for (const p of owned) {
      const code = p.aff_code?.trim();
      // The RANDOM sentinel is an instruction, never a code.
      if (!code || code.toUpperCase() === "RANDOM") continue;
      if (byCode.has(code)) continue;
      byCode.set(code, {
        code,
        source: "user",
        id: null,
        label: p.name,
      });
    }
    for (const row of registered) {
      const code = row.code.trim();
      if (!code) continue;
      // A code the admin registered wins the label (more authoritative).
      byCode.set(code, {
        code,
        source: "admin",
        id: row.id,
        label: row.note,
      });
    }
    return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
  }

  /**
   * Draw one code for a site. `seed` makes the choice deterministic for a
   * single response so repeated renders of one page agree; callers pass a
   * per-request value. Returns null when the pool has nothing for this site.
   */
  async draw(
    normalizedBaseUrl: string,
    seed: string
  ): Promise<string | null> {
    const codes = await this.codesForUrl(normalizedBaseUrl);
    if (codes.length === 0) return null;
    let h = 0;
    for (let i = 0; i < seed.length; i++) {
      h = (h * 31 + seed.charCodeAt(i)) | 0;
    }
    const idx = Math.abs(h) % codes.length;
    return codes[idx].code;
  }

  /**
   * Every site that has a pool, with its codes — the admin management view.
   * Sites come from both sources, so a site whose only code was typed by a
   * user still shows up.
   */
  async listPools(): Promise<SitePool[]> {
    const [urls, allProviders, registered] = await Promise.all([
      this.pool.distinctUrls(),
      this.providers.listAllMeta(),
      this.pool.listAll(),
    ]);

    // Base url + codes per site, from both sources.
    const baseUrlByKey = new Map<string, string>();
    const codesByKey = new Map<string, Map<string, PoolCode>>();
    const labelByKey = new Map<string, string | null>();

    const put = (
      key: string,
      baseUrl: string,
      code: string,
      source: PoolCode["source"],
      id: string | null,
      label: string | null
    ) => {
      if (!baseUrlByKey.has(key)) baseUrlByKey.set(key, baseUrl);
      const bucket = codesByKey.get(key) ?? new Map<string, PoolCode>();
      // Admin-registered rows win over user-typed ones for the same code.
      const prev = bucket.get(code);
      if (!prev || source === "admin") {
        bucket.set(code, { code, source, id, label });
      }
      codesByKey.set(key, bucket);
    };

    for (const p of allProviders) {
      const code = p.aff_code?.trim();
      if (!code || code.toUpperCase() === "RANDOM") continue;
      const key = normalizeBaseUrl(p.base_url);
      put(key, p.base_url, code, "user", null, p.name);
    }
    for (const row of registered) {
      put(
        row.normalized_base_url,
        labelByKey.get(row.normalized_base_url) ?? row.normalized_base_url,
        row.code.trim(),
        "admin",
        row.id,
        row.note
      );
    }
    // Sites that only exist because an admin registered a code there.
    for (const url of urls) {
      if (!baseUrlByKey.has(url)) baseUrlByKey.set(url, url);
    }

    return [...baseUrlByKey.entries()]
      .map(([key, baseUrl]) => ({
        normalized_base_url: key,
        base_url: baseUrl,
        codes: [...(codesByKey.get(key)?.values() ?? [])].sort((a, b) =>
          a.code.localeCompare(b.code)
        ),
      }))
      .filter((s) => s.codes.length > 0)
      .sort((a, b) => b.codes.length - a.codes.length);
  }

  /** Admin: register a code for a site (idempotent). */
  async addCode(
    rawBaseUrl: string,
    code: string,
    note: string | null
  ): Promise<PoolCode[]> {
    const normalized = normalizeBaseUrl(rawBaseUrl);
    if (!normalized) throw AppError.validation("请填写站点地址");
    const trimmed = code.trim();
    if (!trimmed) throw AppError.validation("邀请码不能为空");
    if (trimmed.toUpperCase() === "RANDOM") {
      throw AppError.validation("RANDOM 是保留值，不能作为邀请码");
    }
    await this.pool.add(normalized, trimmed, note);
    logger.info({ normalized, code: trimmed }, "invite code registered");
    return this.codesForUrl(normalized);
  }

  /** Admin: remove a registered code. User-typed codes are removed on the site. */
  async removeCode(id: string): Promise<void> {
    await this.pool.remove(id);
  }
}

export const inviteCodeService = new InviteCodeService();
