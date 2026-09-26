import type { Kysely } from "kysely";
import type { DatabaseSchema } from "../db";
import type { ProviderType, FreeTier } from "../../domain/provider";

type StatsRow = DatabaseSchema["provider_stats"];

/** Aggregated, cross-user view of one base_url (ADR-0010). No key material. */
export interface ProviderStat {
  normalized_base_url: string;
  base_url: string;
  name: string | null;
  icon: string | null;
  type: ProviderType | null;
  free_tier: FreeTier | null;
  admin_name: string | null;
  admin_icon: string | null;
  admin_type: ProviderType | null;
  admin_free_tier: FreeTier | null;
  type_votes: Record<string, number>;
  free_tier_votes: Record<string, number>;
  user_count: number;
  updated_at: string;
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toStat(row: StatsRow): ProviderStat {
  return {
    normalized_base_url: row.normalized_base_url,
    base_url: row.base_url,
    name: row.name,
    icon: row.icon,
    type: row.type as ProviderType | null,
    free_tier: row.free_tier as FreeTier | null,
    admin_name: row.admin_name,
    admin_icon: row.admin_icon,
    admin_type: row.admin_type as ProviderType | null,
    admin_free_tier: row.admin_free_tier as FreeTier | null,
    type_votes: parseJson<Record<string, number>>(row.type_votes, {}),
    free_tier_votes: parseJson<Record<string, number>>(row.free_tier_votes, {}),
    user_count: row.user_count,
    updated_at: row.updated_at,
  };
}

export interface StatUpsert {
  normalized_base_url: string;
  base_url: string;
  name: string | null;
  icon: string | null;
  type: ProviderType | null;
  free_tier: FreeTier | null;
  type_votes: Record<string, number>;
  free_tier_votes: Record<string, number>;
  user_count: number;
}

/** Reads + writes for the provider_stats aggregate table. */
export class StatsRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async list(): Promise<ProviderStat[]> {
    const rows = await this.db
      .selectFrom("provider_stats")
      .selectAll()
      .orderBy("user_count", "desc")
      .execute();
    return rows.map(toStat);
  }

  async get(normalizedBaseUrl: string): Promise<ProviderStat | undefined> {
    const row = await this.db
      .selectFrom("provider_stats")
      .selectAll()
      .where("normalized_base_url", "=", normalizedBaseUrl)
      .executeTakeFirst();
    return row ? toStat(row) : undefined;
  }

  /** Write the derived (non-admin) aggregate fields, preserving admin overrides. */
  async upsertDerived(stat: StatUpsert): Promise<void> {
    const now = new Date().toISOString();
    const existing = await this.get(stat.normalized_base_url);
    const set = {
      base_url: stat.base_url,
      name: existing?.admin_name ?? stat.name,
      icon: existing?.admin_icon ?? stat.icon,
      type: existing?.admin_type ?? stat.type,
      free_tier: existing?.admin_free_tier ?? stat.free_tier,
      type_votes: JSON.stringify(stat.type_votes),
      free_tier_votes: JSON.stringify(stat.free_tier_votes),
      user_count: stat.user_count,
      updated_at: now,
    };
    if (existing) {
      await this.db
        .updateTable("provider_stats")
        .set(set)
        .where("normalized_base_url", "=", stat.normalized_base_url)
        .execute();
    } else {
      await this.db
        .insertInto("provider_stats")
        .values({
          normalized_base_url: stat.normalized_base_url,
          admin_name: null,
          admin_icon: null,
          admin_type: null,
          admin_free_tier: null,
          ...set,
        })
        .execute();
    }
  }

  async remove(normalizedBaseUrl: string): Promise<void> {
    await this.db
      .deleteFrom("provider_stats")
      .where("normalized_base_url", "=", normalizedBaseUrl)
      .execute();
  }
}
