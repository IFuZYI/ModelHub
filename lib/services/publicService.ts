import { getDatabase } from "../infra/db";
import { UserProviderRepository } from "../infra/repositories/userProviderRepo";
import { UserRepository } from "../infra/repositories/userRepo";
import { UserProfileRepository } from "../infra/repositories/userProfileRepo";
import { TagRepository } from "../infra/repositories/tagRepo";
import { RatingRepository } from "../infra/repositories/ratingRepo";
import { CommentRepository } from "../infra/repositories/commentRepo";
import { AppError } from "../domain/errors";
import { buildInviteUrl, type ProviderType, type FreeTier } from "../domain/provider";
import { modelDedupeKey } from "../domain/vendor";
import type { CommentView, RatingSummary } from "../domain/blog";

/** Public, read-only projection of a provider for guests (no key material). */
export interface PublicProvider {
  id: string;
  name: string;
  description: string | null;
  type: ProviderType;
  base_url: string;
  free_tier: FreeTier;
  icon: string | null;
  aff_code: string | null;
  invite_url: string | null;
  model_count: number;
  register_methods: string[];
  /** Author identity (blog-style). */
  author: {
    id: string;
    username: string;
    display_name: string | null;
    avatar: string | null;
    slug: string | null;
  } | null;
  /** Custom tags. */
  tags: { slug: string; name: string }[];
  /** Star rating aggregate. */
  rating: RatingSummary;
  /** Comment count. */
  comment_count: number;
}

export interface PublicProviderDetail extends PublicProvider {
  models: string[];
}

/** Public page payload: author identity + that author's providers. */
export interface PublicPage {
  owner: {
    username: string;
    slug: string | null;
    display_name: string | null;
    bio: string | null;
    avatar: string | null;
  };
  providers: PublicProvider[];
  total_model_count: number;
  /** Aggregate stats for the author's page. */
  total_rating: { average: number | null; count: number };
  total_comments: number;
}

/**
 * Read-only public views (ADR-0010/0012, extended v0.4): the homepage shows
 * the (first) admin's providers; a personal page shows one user's providers
 * by slug, blog-style. Guests only ever see these — never keys, diagnostics,
 * or other users' data.
 */
export class PublicService {
  private readonly providers: UserProviderRepository;
  private readonly users: UserRepository;
  private readonly profiles: UserProfileRepository;
  private readonly tags: TagRepository;
  private readonly ratings: RatingRepository;
  private readonly comments: CommentRepository;

  constructor(
    providers = new UserProviderRepository(getDatabase()),
    users = new UserRepository(getDatabase()),
    profiles = new UserProfileRepository(getDatabase()),
    tags = new TagRepository(getDatabase()),
    ratings = new RatingRepository(getDatabase()),
    comments = new CommentRepository(getDatabase())
  ) {
    this.providers = providers;
    this.users = users;
    this.profiles = profiles;
    this.tags = tags;
    this.ratings = ratings;
    this.comments = comments;
  }

  private async assemble(
    owned: {
      id: string;
      name: string;
      description: string | null;
      type: ProviderType;
      base_url: string;
      free_tier: FreeTier;
      icon: string | null;
      aff_code: string | null;
      register_methods: string[];
      models: string[];
      user_id: string;
    }[]
  ): Promise<PublicProvider[]> {
    const ids = owned.map((p) => p.id);
    const ownerIds = owned.map((p) => p.user_id);
    const [tagsBy, ratingsBy, commentsBy, users, profiles] = await Promise.all([
      this.tags.tagsForProviders(ids),
      this.ratings.summariesFor(ids),
      this.comments.countsFor(ids),
      // Only the authors actually referenced (a detail view must not load
      // every user row just to resolve one author).
      this.users.getIdentities(ownerIds),
      this.profiles.getMany(ownerIds),
    ]);
    const usersById = new Map(users.map((u) => [u.id, u]));
    return owned.map((p) => {
      const user = usersById.get(p.user_id);
      const profile = profiles.get(p.user_id);
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        type: p.type,
        base_url: p.base_url,
        free_tier: p.free_tier,
        icon: p.icon,
        aff_code: p.aff_code,
        invite_url: buildInviteUrl(p.base_url, p.aff_code),
        model_count: p.models.length,
        register_methods: p.register_methods,
        author: user
          ? {
              id: user.id,
              username: user.username,
              display_name: profile?.display_name ?? null,
              avatar: profile?.avatar ?? null,
              slug: user.slug,
            }
          : null,
        tags: (tagsBy.get(p.id) ?? []).map((t) => ({
          slug: t.slug,
          name: t.name,
        })),
        rating:
          ratingsBy.get(p.id) ?? {
            average: null,
            count: 0,
            distribution: [0, 0, 0, 0, 0, 0],
          },
        comment_count: commentsBy.get(p.id) ?? 0,
      };
    });
  }

  private summarize(providers: PublicProvider[], models: string[][]) {
    return {
      providers,
      total_model_count: new Set(
        models.flatMap((m) => m.map(modelDedupeKey).filter(Boolean))
      ).size,
    };
  }

  /** The first active admin account, or undefined on a fresh install. */
  private async firstAdmin() {
    const users = await this.users.list();
    return users.find((u) => u.role === "admin" && u.status === "active");
  }

  /** Homepage: the primary admin's providers (summaries). */
  async homepage(): Promise<{
    providers: PublicProvider[];
    total_model_count: number;
  }> {
    const admin = await this.firstAdmin();
    if (!admin) return { providers: [], total_model_count: 0 };
    const owned = await this.providers.listByUser(admin.id);
    const assembled = await this.assemble(owned);
    return this.summarize(
      assembled,
      owned.map((p) => p.models)
    );
  }

  /** Personal page by slug. Throws NOT_FOUND when the slug is unknown. */
  async personalPage(slug: string): Promise<PublicPage> {
    const user = await this.users.getBySlug(slug);
    if (!user || user.status !== "active") {
      throw AppError.notFound("Page not found");
    }
    const owned = await this.providers.listByUser(user.id);
    const assembled = await this.assemble(owned);
    const { providers, total_model_count } = this.summarize(
      assembled,
      owned.map((p) => p.models)
    );
    const profile = await this.profiles.get(user.id);
    // Page-level aggregates. Use the raw score distribution (not the already
    // 0.1-rounded per-provider average) so the page average has no double
    // rounding error.
    let ratingTotal = 0;
    let ratingCount = 0;
    let totalComments = 0;
    for (const p of assembled) {
      if (p.rating.count > 0) {
        for (let score = 0; score < p.rating.distribution.length; score++) {
          ratingTotal += score * p.rating.distribution[score];
        }
        ratingCount += p.rating.count;
      }
      totalComments += p.comment_count;
    }
    return {
      owner: {
        username: user.username,
        slug: user.slug,
        display_name: profile?.display_name ?? null,
        bio: profile?.bio ?? null,
        avatar: profile?.avatar ?? null,
      },
      providers,
      total_model_count,
      total_rating: {
        average:
          ratingCount > 0
            ? Math.round((ratingTotal / ratingCount) * 10) / 10
            : null,
        count: ratingCount,
      },
      total_comments: totalComments,
    };
  }

  /** Public provider detail (models included, no key) + social data. */
  async detail(
    id: string,
    viewerId?: string
  ): Promise<PublicProviderDetail & { comments: CommentView[] }> {
    const p = await this.providers.getById(id);
    if (!p) throw AppError.notFound("Provider not found");
    // A disabled owner's sites disappear from public view entirely
    // (consistent with the personal page, which 404s disabled users).
    const owner = await this.users.getById(p.user_id);
    if (!owner || owner.status !== "active") {
      throw AppError.notFound("Provider not found");
    }
    const [assembled] = await this.assemble([p]);
    const comments = await this.comments.listForProvider(id);
    return {
      ...assembled,
      models: p.models,
      comments: comments.map((c) => ({ ...c, mine: viewerId === c.user_id })),
    };
  }
}

export const publicService = new PublicService();
