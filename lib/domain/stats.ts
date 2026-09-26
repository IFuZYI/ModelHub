import type { ProviderType, FreeTier } from "./provider";

/** One user's configuration of a base_url, reduced to the fields stats care about. */
export interface StatContribution {
  name: string;
  icon: string | null;
  type: ProviderType;
  free_tier: FreeTier;
}

export interface DerivedStat {
  name: string | null;
  icon: string | null;
  type: ProviderType | null;
  free_tier: FreeTier | null;
  type_votes: Record<string, number>;
  free_tier_votes: Record<string, number>;
  user_count: number;
}

/** Most-frequent value in a list; ties broken by first-seen order. */
function mode<T extends string>(values: T[]): T | null {
  const counts = new Map<T, number>();
  const order: T[] = [];
  for (const v of values) {
    if (!counts.has(v)) order.push(v);
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: T | null = null;
  let bestCount = -1;
  for (const v of order) {
    const c = counts.get(v) ?? 0;
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

function tally<T extends string>(values: T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

/**
 * Aggregate all users' contributions for one base_url into the derived stat
 * fields (ADR-0010). name/icon take the most-used value; type/free_tier take
 * the most-voted, and per-option vote counts are returned. Admin overrides are
 * layered on separately by the repository.
 */
export function deriveStat(contributions: StatContribution[]): DerivedStat {
  const names = contributions.map((c) => c.name).filter(Boolean);
  const icons = contributions
    .map((c) => c.icon)
    .filter((x): x is string => Boolean(x));
  const types = contributions.map((c) => c.type);
  const freeTiers = contributions.map((c) => c.free_tier);
  return {
    name: mode(names),
    icon: mode(icons),
    type: mode(types),
    free_tier: mode(freeTiers),
    type_votes: tally(types),
    free_tier_votes: tally(freeTiers),
    user_count: contributions.length,
  };
}
