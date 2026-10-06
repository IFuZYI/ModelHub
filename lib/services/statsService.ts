import { getDatabase } from "../infra/db";
import {
  UserProviderRepository,
  type OwnedProviderMeta,
} from "../infra/repositories/userProviderRepo";
import { UserRepository } from "../infra/repositories/userRepo";
import {
  StatsRepository,
  type ProviderStat,
} from "../infra/repositories/statsRepo";
import { deriveStat, type StatContribution } from "../domain/stats";
import {
  normalizeBaseUrl,
  type ProviderType,
  type FreeTier,
} from "../domain/provider";
import { AppError } from "../domain/errors";

/** A stats row plus whether the admin already mounts this base_url. */
export interface ProviderStatView extends ProviderStat {
  admin_added: boolean;
  /** Effective display values (admin override else derived). */
  effective_name: string | null;
  effective_icon: string | null;
  effective_type: ProviderType | null;
  effective_free_tier: FreeTier | null;
}

export class StatsService {
  private readonly providers: UserProviderRepository;
  private readonly users: UserRepository;
  private readonly stats: StatsRepository;
  constructor(
    providers = new UserProviderRepository(getDatabase()),
    users = new UserRepository(getDatabase()),
    stats = new StatsRepository(getDatabase())
  ) {
    this.providers = providers;
    this.users = users;
    this.stats = stats;
  }

  /** Recompute the aggregate row for one base_url from all users' configs. */
  async recompute(normalizedBaseUrl: string): Promise<void> {
    const matching =
      await this.providers.listMetaByNormalizedUrl(normalizedBaseUrl);
    await this.applyRecompute(normalizedBaseUrl, matching);
  }

  /** Shared write half of recompute(): derive + upsert (or drop when empty). */
  private async applyRecompute(
    normalizedBaseUrl: string,
    matching: OwnedProviderMeta[]
  ): Promise<void> {
    if (matching.length === 0) {
      await this.stats.remove(normalizedBaseUrl);
      return;
    }
    const contributions: StatContribution[] = matching.map((p) => ({
      name: p.name,
      icon: p.icon,
      type: p.type,
      free_tier: p.free_tier,
    }));
    const derived = deriveStat(contributions);
    await this.stats.upsertDerived({
      normalized_base_url: normalizedBaseUrl,
      base_url: matching[0].base_url,
      ...derived,
    });
  }

  /**
   * Sweep every stats row: drop the ones no provider mounts any more, and
   * RE-DERIVE the ones that are still live.
   *
   * The per-URL recompute is driven by writes, so it cannot see a row whose
   * URL is no longer referenced by anyone (e.g. rows left behind by deletes
   * that predate the recompute-on-delete fix, or by a manual DB edit). This
   * heals them. Re-deriving live rows additionally heals drift introduced by
   * paths that bypass the write-time recompute — most notably a transfer
   * import, which carries provider_stats as-is (its admin_* columns are
   * authored data) and would otherwise leave the aggregate table showing a
   * stale type/free_tier forever. Admin overrides are preserved: upsertDerived
   * layers them back on top of the derived values.
   */
  async recomputeAll(): Promise<number> {
    const rows = await this.stats.list();
    let removed = 0;
    for (const row of rows) {
      const matching = await this.providers.listMetaByNormalizedUrl(
        row.normalized_base_url
      );
      if (matching.length === 0) {
        await this.stats.remove(row.normalized_base_url);
        removed++;
      } else {
        // Reuse the already-loaded providers (recompute() would re-query the
        // same URL) and skip the write when nothing actually changed, so a
        // no-op sweep does not churn updated_at on every live row.
        const derived = deriveStat(
          matching.map((p) => ({
            name: p.name,
            icon: p.icon,
            type: p.type,
            free_tier: p.free_tier,
          }))
        );
        if (!this.isDrifted(row, matching[0].base_url, derived)) continue;
        await this.applyRecompute(row.normalized_base_url, matching);
      }
    }
    return removed;
  }

  /** True when the stored row disagrees with what the providers derive. */
  private isDrifted(
    row: ProviderStat,
    baseUrl: string,
    derived: ReturnType<typeof deriveStat>
  ): boolean {
    const eq = (a: unknown, b: unknown) =>
      JSON.stringify(a) === JSON.stringify(b);
    return (
      row.base_url !== baseUrl ||
      // The stored columns already have admin overrides layered on top, so a
      // drifted row shows the derived value here only when no override masks
      // it; comparing against the override-aware values avoids false positives.
      row.name !== (row.admin_name ?? derived.name) ||
      row.icon !== (row.admin_icon ?? derived.icon) ||
      row.type !== (row.admin_type ?? derived.type) ||
      row.free_tier !== (row.admin_free_tier ?? derived.free_tier) ||
      !eq(row.type_votes, derived.type_votes) ||
      !eq(row.free_tier_votes, derived.free_tier_votes) ||
      row.user_count !== derived.user_count
    );
  }

  /** Full-service stats list, annotated with admin-added + effective values. */
  async list(): Promise<ProviderStatView[]> {
    const [stats, admins, allProviders] = await Promise.all([
      this.stats.list(),
      this.users.list().then((us) => us.filter((u) => u.role === "admin")),
      this.providers.listAllMeta(),
    ]);
    const adminIds = new Set(admins.map((a) => a.id));
    const adminUrls = new Set(
      allProviders
        .filter((p) => adminIds.has(p.user_id))
        .map((p) => normalizeBaseUrl(p.base_url))
    );
    return stats.map((s) => ({
      ...s,
      admin_added: adminUrls.has(s.normalized_base_url),
      effective_name: s.admin_name ?? s.name,
      effective_icon: s.admin_icon ?? s.icon,
      effective_type: s.admin_type ?? s.type,
      effective_free_tier: s.admin_free_tier ?? s.free_tier,
    }));
  }

  /** Data an admin one-click-add form needs, derived from the stat row. */
  async addTemplate(normalizedBaseUrl: string): Promise<{
    name: string;
    base_url: string;
    type: ProviderType;
    free_tier: FreeTier;
    icon: string | null;
  }> {
    const stat = await this.stats.get(normalizedBaseUrl);
    if (!stat) throw AppError.notFound("Unknown provider URL");
    return {
      name: stat.admin_name ?? stat.name ?? stat.base_url,
      base_url: stat.base_url,
      type: (stat.admin_type ?? stat.type ?? "custom") as ProviderType,
      free_tier: (stat.admin_free_tier ?? stat.free_tier ?? "none") as FreeTier,
      icon: stat.admin_icon ?? stat.icon,
    };
  }

  /** Admin sets an authoritative override for a base_url's display fields. */
  async setAdminOverride(
    normalizedBaseUrl: string,
    override: {
      name?: string | null;
      icon?: string | null;
      type?: ProviderType | null;
      free_tier?: FreeTier | null;
    }
  ): Promise<void> {
    const db = getDatabase();
    const set: Record<string, unknown> = {};
    if (override.name !== undefined) set.admin_name = override.name;
    if (override.icon !== undefined) set.admin_icon = override.icon;
    if (override.type !== undefined) set.admin_type = override.type;
    if (override.free_tier !== undefined)
      set.admin_free_tier = override.free_tier;
    if (Object.keys(set).length === 0) return;
    await db
      .updateTable("provider_stats")
      .set(set)
      .where("normalized_base_url", "=", normalizedBaseUrl)
      .execute();
    // Re-derive so the effective (name/type/...) columns reflect the override.
    await this.recompute(normalizedBaseUrl);
  }
}

export const statsService = new StatsService();
