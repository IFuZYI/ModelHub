import { z } from "zod";

/**
 * Blog-layer domain: tags, ratings, comments, author profiles (v0.4).
 * Pure types + schemas + helpers — no IO.
 */

// ---- tags (Hugo-style taxonomy) ----

export interface Tag {
  id: string;
  /** Stable URL-safe identifier derived from the name. */
  slug: string;
  /** Display name as entered by the user. */
  name: string;
  created_at: string;
}

/** A tag with usage metadata for listing/autocomplete. */
export interface TagWithCount extends Tag {
  /** How many user_providers carry this tag. */
  count: number;
}

/** Max tags per provider. */
export const MAX_TAGS_PER_PROVIDER = 12;
/** Max length of a tag name. */
export const MAX_TAG_NAME_LENGTH = 40;

/**
 * Normalize a tag name into a stable slug: trim, lowercase, collapse
 * whitespace/underscores to single hyphens, strip anything that is not a
 * letter, digit, hyphen, or CJK character. CJK names keep their characters
 * (URL-encoded when needed) so Chinese tags remain readable.
 */
export function tagSlug(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  const cleaned = trimmed
    .replace(/[\s_]+/g, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned;
}

/** A tag name is valid when its slug is non-empty after normalization. */
export function isValidTagName(raw: string): boolean {
  const name = raw.trim();
  if (!name || name.length > MAX_TAG_NAME_LENGTH) return false;
  return tagSlug(name).length > 0;
}

export const tagNameSchema = z
  .string()
  .trim()
  .min(1, "标签不能为空")
  .max(MAX_TAG_NAME_LENGTH)
  .refine((v) => tagSlug(v).length > 0, "标签格式无效");

export const tagNamesSchema = z
  .array(tagNameSchema)
  .max(MAX_TAGS_PER_PROVIDER, `最多 ${MAX_TAGS_PER_PROVIDER} 个标签`);

// ---- ratings ----

export const MIN_RATING = 0;
export const MAX_RATING = 5;

export const ratingScoreSchema = z
  .number()
  .int()
  .min(MIN_RATING)
  .max(MAX_RATING);

/** Aggregate rating summary for a provider. */
export interface RatingSummary {
  /** Average score rounded to one decimal; null when no ratings. */
  average: number | null;
  /** Total number of ratings. */
  count: number;
  /** Distribution: index 0..5 → count of that score. */
  distribution: number[];
}

/** One user's rating of a provider. */
export interface RatingView {
  score: number;
  /** Author identity (for the "rated by" list). */
  user_id: string;
  username: string;
}

export function emptyRatingSummary(): RatingSummary {
  return { average: null, count: 0, distribution: [0, 0, 0, 0, 0, 0] };
}

/** Fold raw score rows into a summary (pure). */
export function summarizeRatings(scores: number[]): RatingSummary {
  if (scores.length === 0) return emptyRatingSummary();
  const distribution = [0, 0, 0, 0, 0, 0];
  let total = 0;
  for (const s of scores) {
    if (s >= MIN_RATING && s <= MAX_RATING) {
      distribution[s] += 1;
      total += s;
    }
  }
  const count = distribution.reduce((a, b) => a + b, 0);
  const average = count > 0 ? Math.round((total / count) * 10) / 10 : null;
  return { average, count, distribution };
}

// ---- comments ----

export const MAX_COMMENT_LENGTH = 2000;

export const commentBodySchema = z
  .string()
  .trim()
  .min(1, "评论不能为空")
  .max(MAX_COMMENT_LENGTH, `评论最多 ${MAX_COMMENT_LENGTH} 字`);

export interface CommentView {
  id: string;
  body: string;
  created_at: string;
  updated_at: string;
  /** Author identity. */
  user_id: string;
  username: string;
  /** True when the viewer wrote this comment (client convenience). */
  mine?: boolean;
}

// ---- author profile ----

export const MAX_DISPLAY_NAME_LENGTH = 40;
export const MAX_BIO_LENGTH = 500;

export const profileUpdateSchema = z
  .object({
    display_name: z
      .string()
      .trim()
      .max(MAX_DISPLAY_NAME_LENGTH)
      .nullable()
      .optional(),
    bio: z.string().trim().max(MAX_BIO_LENGTH).nullable().optional(),
    // Only http(s) URLs: the avatar renders as an <img src> on public pages,
    // so data:/javascript:/tracking schemes must not pass validation.
    avatar: z
      .string()
      .trim()
      .max(300)
      .refine(
        (v) => /^https?:\/\//i.test(v),
        { message: "avatar must be an http(s) URL" }
      )
      .nullable()
      .optional(),
  })
  .refine((o) => Object.keys(o).length > 0, {
    message: "at least one field is required",
  });

export interface UserProfile {
  user_id: string;
  display_name: string | null;
  bio: string | null;
  avatar: string | null;
  updated_at: string;
}

/** A user's public identity on their page. */
export interface AuthorView {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar: string | null;
  slug: string | null;
}

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
