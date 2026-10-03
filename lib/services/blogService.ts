import { getDatabase } from "../infra/db";
import { UserRepository } from "../infra/repositories/userRepo";
import { UserProviderRepository } from "../infra/repositories/userProviderRepo";
import { TagRepository } from "../infra/repositories/tagRepo";
import { RatingRepository } from "../infra/repositories/ratingRepo";
import { CommentRepository } from "../infra/repositories/commentRepo";
import { UserProfileRepository } from "../infra/repositories/userProfileRepo";
import { AppError } from "../domain/errors";
import {
  commentBodySchema,
  profileUpdateSchema,
  ratingScoreSchema,
  tagNamesSchema,
  type CommentView,
  type RatingSummary,
  type RatingView,
  type Tag,
  type TagWithCount,
} from "../domain/blog";
import { toUserView } from "../domain/user";

/**
 * Blog-layer use-cases (v0.4): author profiles, tags, ratings, comments.
 *
 * Everything here is keyed by an existing user_provider (a "post" in the
 * blog metaphor). Mutations check ownership where required; reads are safe
 * for guests unless stated otherwise.
 */
export class BlogService {
  private readonly providers: UserProviderRepository;
  private readonly users: UserRepository;
  private readonly tags: TagRepository;
  private readonly ratings: RatingRepository;
  private readonly comments: CommentRepository;
  private readonly profiles: UserProfileRepository;

  constructor(
    providers = new UserProviderRepository(getDatabase()),
    users = new UserRepository(getDatabase()),
    tags = new TagRepository(getDatabase()),
    ratings = new RatingRepository(getDatabase()),
    comments = new CommentRepository(getDatabase()),
    profiles = new UserProfileRepository(getDatabase())
  ) {
    this.providers = providers;
    this.users = users;
    this.tags = tags;
    this.ratings = ratings;
    this.comments = comments;
    this.profiles = profiles;
  }

  // ---- tags ----

  /** All tags with usage counts (public). */
  async listTags(): Promise<TagWithCount[]> {
    return this.tags.listWithCounts();
  }

  /** Tags of one provider (public). */
  async providerTags(providerId: string): Promise<Tag[]> {
    return this.tags.tagsForProvider(providerId);
  }

  /**
   * Replace the tags of an owned provider. Names are resolved/created in the
   * global vocabulary, links are rewritten and orphans pruned — all in one
   * transaction (see TagRepository.replaceProviderTags) so concurrent
   * writers cannot delete a tag mid-attach.
   */
  async setProviderTags(
    userId: string,
    providerId: string,
    names: string[]
  ): Promise<Tag[]> {
    const owned = await this.providers.getById(providerId);
    if (!owned || owned.user_id !== userId) {
      throw AppError.notFound("Provider not found");
    }
    const parsed = tagNamesSchema.parse(names);
    return this.tags.replaceProviderTags(providerId, parsed);
  }

  // ---- ratings ----

  /** Rating summary for one provider (public). */
  async ratingSummary(providerId: string): Promise<RatingSummary> {
    return this.ratings.summaryFor(providerId);
  }

  /** Ratings with usernames for one provider (public). */
  async ratingList(providerId: string): Promise<RatingView[]> {
    return this.ratings.listForProvider(providerId);
  }

  /** The viewer's own score, or null (authenticated). */
  async myRating(providerId: string, userId: string): Promise<number | null> {
    return this.ratings.myScore(providerId, userId);
  }

  /** Upsert a rating (authenticated). Returns the fresh summary + own score. */
  async rate(
    userId: string,
    providerId: string,
    score: number
  ): Promise<{ summary: RatingSummary; my_score: number }> {
    const parsed = ratingScoreSchema.parse(score);
    const provider = await this.providers.getById(providerId);
    if (!provider) throw AppError.notFound("Provider not found");
    await this.ratings.upsert(providerId, userId, parsed);
    return {
      summary: await this.ratings.summaryFor(providerId),
      my_score: parsed,
    };
  }

  /** Remove own rating (authenticated). */
  async unrate(userId: string, providerId: string): Promise<RatingSummary> {
    await this.ratings.remove(providerId, userId);
    return this.ratings.summaryFor(providerId);
  }

  // ---- comments ----

  /** Comments for one provider (public), newest first. */
  async commentList(
    providerId: string,
    viewerId?: string
  ): Promise<CommentView[]> {
    const list = await this.comments.listForProvider(providerId);
    return list.map((c) => ({ ...c, mine: viewerId === c.user_id }));
  }

  /** Post a comment (authenticated). */
  async comment(
    userId: string,
    providerId: string,
    body: string
  ): Promise<CommentView> {
    const parsed = commentBodySchema.parse(body);
    const provider = await this.providers.getById(providerId);
    if (!provider) throw AppError.notFound("Provider not found");
    const view = await this.comments.insert(providerId, userId, parsed);
    const user = await this.users.getById(userId);
    // The author is by definition the current user — mark it so the client
    // renders the delete action immediately without a refetch.
    return { ...view, username: user?.username ?? "", mine: true };
  }

  /**
   * Delete a comment. Allowed for the comment author or the provider owner.
   */
  async deleteComment(userId: string, commentId: string): Promise<void> {
    const comment = await this.comments.getById(commentId);
    if (!comment) throw AppError.notFound("Comment not found");
    if (comment.user_id !== userId) {
      const provider = await this.providers.getById(comment.user_provider_id);
      if (!provider || provider.user_id !== userId) {
        throw AppError.notFound("Comment not found");
      }
    }
    await this.comments.remove(commentId);
  }

  // ---- author profile ----

  /** Read own profile + account view (authenticated). */
  async myProfile(userId: string): Promise<{
    account: ReturnType<typeof toUserView>;
    display_name: string | null;
    bio: string | null;
    avatar: string | null;
  }> {
    const user = await this.users.getById(userId);
    if (!user) throw AppError.notFound("User not found");
    const profile = await this.profiles.get(userId);
    return {
      account: toUserView(user),
      display_name: profile?.display_name ?? null,
      bio: profile?.bio ?? null,
      avatar: profile?.avatar ?? null,
    };
  }

  /** Update own profile (authenticated). Empty string clears a field. */
  async updateProfile(
    userId: string,
    patch: {
      display_name?: string | null;
      bio?: string | null;
      avatar?: string | null;
    }
  ): Promise<{ display_name: string | null; bio: string | null; avatar: string | null }> {
    const parsed = profileUpdateSchema.parse(patch);
    const normalized = {
      display_name: parsed.display_name === undefined ? undefined : parsed.display_name || null,
      bio: parsed.bio === undefined ? undefined : parsed.bio || null,
      avatar: parsed.avatar === undefined ? undefined : parsed.avatar || null,
    };
    const profile = await this.profiles.upsert(userId, normalized);
    return {
      display_name: profile.display_name,
      bio: profile.bio,
      avatar: profile.avatar,
    };
  }
}

export const blogService = new BlogService();
