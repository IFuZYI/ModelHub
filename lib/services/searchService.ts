import { getDatabase } from "../infra/db";
import { UserProviderRepository } from "../infra/repositories/userProviderRepo";
import { UserRepository } from "../infra/repositories/userRepo";
import { UserProfileRepository } from "../infra/repositories/userProfileRepo";
import { TagRepository } from "../infra/repositories/tagRepo";
import { RatingRepository } from "../infra/repositories/ratingRepo";
import { modelVendor, vendorLabel } from "../domain/vendor";
import type { RatingSummary } from "../domain/blog";
import type { ProviderType, FreeTier } from "../domain/provider";

/** Cap on matched model ids returned per hit (payload size guard). */
const MAX_MATCHED_MODELS = 120;

export interface SearchHitAuthor {
  id: string;
  username: string;
  display_name: string | null;
  avatar: string | null;
  slug: string | null;
}

export interface SearchHit {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  type: ProviderType;
  base_url: string;
  free_tier: FreeTier;
  model_count: number;
  updated_at: string | null;
  author: SearchHitAuthor;
  tags: { slug: string; name: string }[];
  rating: RatingSummary;
  /** Model ids that matched the query (capped). */
  matched_models: string[];
  /** Total matched models before the cap. */
  matched_model_count: number;
  /** Vendors whose models matched (e.g. searching "openai"). */
  matched_vendors: string[];
  /** Why this hit matched: "model" | "vendor" | "name" | "tag". */
  reasons: string[];
}

export interface SearchResult {
  query: string;
  hits: SearchHit[];
  total: number;
}

export interface SearchOptions {
  /** Filter to one author slug. */
  author?: string;
  /** Filter to one tag slug. */
  tag?: string;
  /** Filter to one provider type. */
  type?: ProviderType;
  /** Max hits returned (default 100). */
  limit?: number;
}

/**
 * Cross-site search (v0.4): find which sites ("posts") have a given model or
 * come from a given source/vendor, plus name and tag matches.
 *
 * - model: any model id containing the query (e.g. "gpt-6")
 * - vendor: modelVendor/vendorLabel of any model contains the query
 *   (e.g. "openai", "通义千问")
 * - name: provider name or base_url contains the query
 * - tag: any of the provider's tags contains the query
 *
 * Reads are public; the caller decides whether to surface diagnostics.
 */
export class SearchService {
  private readonly providers: UserProviderRepository;
  private readonly users: UserRepository;
  private readonly profiles: UserProfileRepository;
  private readonly tags: TagRepository;
  private readonly ratings: RatingRepository;

  constructor(
    providers = new UserProviderRepository(getDatabase()),
    users = new UserRepository(getDatabase()),
    profiles = new UserProfileRepository(getDatabase()),
    tags = new TagRepository(getDatabase()),
    ratings = new RatingRepository(getDatabase())
  ) {
    this.providers = providers;
    this.users = users;
    this.profiles = profiles;
    this.tags = tags;
    this.ratings = ratings;
  }

  async search(rawQuery: string, options: SearchOptions = {}): Promise<SearchResult> {
    const query = rawQuery.trim().toLowerCase();
    const limit = options.limit ?? 100;

    const all = await this.providers.listAll();
    if (all.length === 0) return { query: rawQuery, hits: [], total: 0 };

    const ownerIds = all.map((p) => p.user_id);
    const [users, profiles, tagsByProvider, ratingsByProvider] = await Promise.all([
      this.users.getIdentities(ownerIds),
      this.profiles.getMany(ownerIds),
      this.tags.tagsForProviders(all.map((p) => p.id)),
      this.ratings.summariesFor(all.map((p) => p.id)),
    ]);
    const usersById = new Map(users.map((u) => [u.id, u]));

    // Optional author filter resolves slug → user id first.
    let authorId: string | null = null;
    if (options.author) {
      const u = users.find(
        (x) => x.slug === options.author || x.username === options.author
      );
      if (!u) return { query: rawQuery, hits: [], total: 0 };
      authorId = u.id;
    }
    // Optional tag filter resolves slug → provider id set first.
    let tagProviderIds: Set<string> | null = null;
    if (options.tag) {
      tagProviderIds = new Set(await this.tags.providerIdsForTagSlug(options.tag));
    }

    const hits: SearchHit[] = [];
    for (const p of all) {
      // Hidden when the owner account is disabled (consistent with the
      // personal page, which 404s disabled users).
      const owner = usersById.get(p.user_id);
      if (!owner || owner.status !== "active") continue;
      if (authorId && p.user_id !== authorId) continue;
      if (options.type && p.type !== options.type) continue;
      if (tagProviderIds && !tagProviderIds.has(p.id)) continue;

      const tags = tagsByProvider.get(p.id) ?? [];
      const reasons: string[] = [];
      const matchedModels: string[] = [];
      const matchedVendors = new Set<string>();

      if (query) {
        // name / base_url
        if (
          p.name.toLowerCase().includes(query) ||
          p.base_url.toLowerCase().includes(query)
        ) {
          reasons.push("name");
        }
        // tags
        if (
          tags.some(
            (t) =>
              t.name.toLowerCase().includes(query) ||
              t.slug.toLowerCase().includes(query)
          )
        ) {
          reasons.push("tag");
        }
        // models + vendors: a hit is a model-id substring match OR a
        // vendor-name match (e.g. "openai" matches openai/gpt-4o via vendor
        // even though the raw string also contains it — vendor wins for the
        // "which sites carry OpenAI models" intent).
        for (const m of p.models) {
          const vendor = modelVendor(m);
          const label = vendorLabel(vendor);
          const vendorHit =
            vendor.toLowerCase().includes(query) ||
            label.toLowerCase().includes(query);
          const modelHit = m.toLowerCase().includes(query);
          if (vendorHit) matchedVendors.add(vendor);
          if (modelHit || vendorHit) matchedModels.push(m);
        }
        if (matchedModels.length > 0) reasons.push("model");
        if (matchedVendors.size > 0) reasons.push("vendor");
      }

      const hasQuery = query.length > 0;
      if (hasQuery && reasons.length === 0) continue;
      if (!hasQuery && (options.author || options.tag || options.type)) {
        // Filter-only browsing (no query) is allowed.
      } else if (!hasQuery && !options.author && !options.tag && !options.type) {
        continue; // empty query with no filters → no results
      }

      const user = usersById.get(p.user_id);
      const profile = profiles.get(p.user_id);
      hits.push({
        id: p.id,
        name: p.name,
        description: p.description,
        icon: p.icon,
        type: p.type,
        base_url: p.base_url,
        free_tier: p.free_tier,
        model_count: p.models.length,
        updated_at: p.updated_at,
        author: {
          id: p.user_id,
          username: user?.username ?? "",
          display_name: profile?.display_name ?? null,
          avatar: profile?.avatar ?? null,
          slug: user?.slug ?? null,
        },
        tags: tags.map((t) => ({ slug: t.slug, name: t.name })),
        rating:
          ratingsByProvider.get(p.id) ?? {
            average: null,
            count: 0,
            distribution: [0, 0, 0, 0, 0, 0],
          },
        matched_models: matchedModels.slice(0, MAX_MATCHED_MODELS),
        matched_model_count: matchedModels.length,
        matched_vendors: [...matchedVendors],
        reasons,
      });
    }

    // Rank: model/vendor matches first (by matched count), then name/tag, then recency.
    const reasonRank = (r: string[]) =>
      r.includes("model") || r.includes("vendor") ? 0 : 1;
    hits.sort((a, b) => {
      const ra = reasonRank(a.reasons);
      const rb = reasonRank(b.reasons);
      if (ra !== rb) return ra - rb;
      if (a.matched_model_count !== b.matched_model_count)
        return b.matched_model_count - a.matched_model_count;
      return (b.updated_at ?? "").localeCompare(a.updated_at ?? "");
    });

    return {
      query: rawQuery,
      hits: hits.slice(0, limit),
      total: hits.length,
    };
  }
}

export const searchService = new SearchService();
