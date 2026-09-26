import { z } from "zod";
import type { EncryptedValue } from "../infra/crypto";

/**
 * Domain model for a provider. Pure types + schemas + mappers — no IO.
 * This is the stable core the rest of the app depends on.
 *
 * Storage is split into two concerns (see infra/repository):
 *   - CONFIG (ProviderConfig): identity + connection + key. No models.
 *     Persisted per-type: providers.official.json / providers.other.json.
 *   - MODEL CACHE (ModelCache): the fetched model list + status + timestamps.
 *     Persisted one file per provider: models/<id>.json.
 * A StoredProvider is the in-memory composition of the two.
 */

/**
 * Provider taxonomy is two-level:
 *   category 官方 (official) → type native (原生) | proxy (中转)
 *   category 其他 (other)    → type newapi (NewAPI) | custom (其他)
 * `category` drives the homepage tabs; `type` is the leaf shown as a badge.
 */
export type ProviderType = "native" | "proxy" | "newapi" | "custom";
export type ProviderCategory = "official" | "other";
export type FetchStatus = "ok" | "error" | "pending" | "needs_key";

/** Map a leaf type to its top-level category. */
export function categoryOf(type: ProviderType): ProviderCategory {
  return type === "native" || type === "proxy" ? "official" : "other";
}

/** All leaf types, for iteration. */
export const PROVIDER_TYPES: ProviderType[] = [
  "native",
  "proxy",
  "newapi",
  "custom",
];

/**
 * Normalize a persisted/legacy type value to a current leaf type. Legacy
 * values (official/aggregator/relay) map unambiguously; unknown → custom.
 */
export function normalizeType(t: string): ProviderType {
  switch (t) {
    case "native":
    case "official":
      return "native";
    case "proxy":
    case "aggregator":
      return "proxy";
    case "newapi":
    case "relay": // legacy "relay" meant a newapi site
      return "newapi";
    case "custom":
      return "custom";
    default:
      return "custom";
  }
}

/** Identifier of the upstream adapter used to fetch this provider's models. */
export const DEFAULT_ADAPTER = "openai-compatible";

/**
 * Free-tier grading, most→least generous:
 *   - "full": fully free (no paid tier expected),
 *   - "free": has a free tier / free tokens alongside paid usage,
 *   - "none": paid only.
 * Only "full" and "free" surface a badge in the UI; "none" shows nothing.
 */
export const FREE_TIERS = ["full", "free", "none"] as const;
export type FreeTier = (typeof FREE_TIERS)[number];

/**
 * No-key catalog adapters that resolve a provider's model list from a public
 * dataset by slug. Order = fallback priority when a provider configures more
 * than one (most authoritative first). A provider stores its slug per source
 * in `catalog_slugs` (adapter id → slug).
 */
export const CATALOG_ADAPTERS = ["spullara", "models-dev", "litellm"] as const;
export type CatalogAdapterId = (typeof CATALOG_ADAPTERS)[number];

/** Map of catalog adapter id → this provider's slug in that source. */
export type CatalogSlugs = Partial<Record<CatalogAdapterId, string>>;

/**
 * Legacy per-source slug fields (pre-catalog_slugs). Kept only so existing
 * data files and payloads still load; migrated into `catalog_slugs` on parse.
 * `llmrates_slug` is retired — dropped on read, not migrated.
 */
const LEGACY_SLUG_FIELDS: Record<string, CatalogAdapterId> = {
  models_dev_slug: "models-dev",
  litellm_slug: "litellm",
  spullara_slug: "spullara",
};

/** Fold legacy `*_slug` fields into a catalog_slugs map (non-destructive). */
function mergeLegacySlugs(
  base: CatalogSlugs | undefined,
  raw: Record<string, unknown>
): CatalogSlugs {
  const out: CatalogSlugs = { ...(base ?? {}) };
  for (const [field, id] of Object.entries(LEGACY_SLUG_FIELDS)) {
    const v = raw[field];
    if (typeof v === "string" && v && !out[id]) out[id] = v;
  }
  return out;
}

/** Slug fields accepted for back-compat but no longer migrated (retired). */
const RETIRED_SLUG_FIELDS = ["llmrates_slug"] as const;

/**
 * Zod `.transform` that migrates a parsed record's legacy fields:
 *   - legacy `*_slug` fields → `catalog_slugs` (then stripped),
 *   - a retired standalone `site_url` → `base_url` when base_url is missing
 *     (the two were merged into one canonical URL),
 * dropping every retired field. Shared by the config + legacy schemas.
 */
function withMergedCatalogSlugs<T extends Record<string, unknown>>(parsed: T) {
  const { catalog_slugs, ...rest } = parsed as T & {
    catalog_slugs?: CatalogSlugs;
  };
  const raw = rest as Record<string, unknown>;
  const merged = mergeLegacySlugs(catalog_slugs, raw);
  // Backfill base_url from a legacy site_url, then drop site_url.
  if (!raw.base_url && typeof raw.site_url === "string") {
    raw.base_url = raw.site_url;
  }
  // free_tier supersedes the legacy boolean `free`: true → "free", false →
  // "none". An explicit free_tier always wins; drop the legacy field after.
  if (raw.free_tier == null) {
    raw.free_tier = raw.free === true ? "free" : "none";
  }
  for (const field of [
    ...Object.keys(LEGACY_SLUG_FIELDS),
    ...RETIRED_SLUG_FIELDS,
    "site_url",
    "free",
  ]) {
    delete raw[field];
  }
  return { ...raw, catalog_slugs: merged };
}

/** Zod schema mirroring the persisted encrypted value (crypto.EncryptedValue). */
const encryptedValueSchema = z.object({
  v: z.literal(1),
  iv: z.string(),
  ct: z.string(),
  tag: z.string(),
});

/** catalog_slugs on the wire: adapter id → non-empty slug. */
const catalogSlugsSchema = z.record(z.string(), z.string());

/** Legacy per-source slug fields, accepted on read and migrated away. */
const legacySlugFields = {
  models_dev_slug: z.string().nullable().optional(),
  litellm_slug: z.string().nullable().optional(),
  spullara_slug: z.string().nullable().optional(),
  // Retired source: accepted so old files still parse, then dropped.
  llmrates_slug: z.string().nullable().optional(),
  // Retired field: base_url and site_url were merged into base_url. Accepted so
  // old files still parse; migrated into base_url when base_url is missing.
  site_url: z.string().nullable().optional(),
};

/** CONFIG: everything about a provider EXCEPT its model list. */
export const providerConfigSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    // Optional human description of the provider (shown on the detail page).
    description: z.string().nullable().default(null),
    // Accept current + legacy type values, normalizing to a current leaf type.
    type: z
      .string()
      .transform((t) => normalizeType(t))
      .pipe(z.enum(["native", "proxy", "newapi", "custom"])),
    // The provider's canonical URL — both the "前往官网" link target and the
    // base for live model fetches. May be optional on the wire when a legacy
    // record only had site_url; the transform backfills it.
    base_url: z.string().optional(),
    // True when the provider offers a free tier / free tokens (FREE tag).
    // Retired in favour of free_tier; accepted on read then folded in.
    free: z.boolean().optional(),
    // Free-tier grading: "full" | "free" | "none". No default here — the
    // transform backfills it (from legacy `free`, else "none") so migration wins.
    free_tier: z.enum(FREE_TIERS).optional(),
    aff_code: z.string().nullable().default(null),
    adapter: z.string().default(DEFAULT_ADAPTER),
    // Per-source catalog slugs (adapter id → slug) for no-key model sync.
    catalog_slugs: catalogSlugsSchema.optional(),
    ...legacySlugFields,
    // key is optional: a public relay may expose /api/pricing without auth
    key_enc: encryptedValueSchema.nullable().default(null),
    // When true, models are a built-in list and refresh must not overwrite them
    // (vendors with no usable /models endpoint, e.g. baidu/Portkey).
    manual_models: z.boolean().default(false),
    // Display glyph/emoji for the provider avatar. Null → fall back to initial.
    icon: z.string().nullable().default(null),
    // Sign-up/login methods (NewAPI /api/status), e.g. ["密码注册","GitHub"].
    register_methods: z.array(z.string()).default([]),
  })
  .transform((parsed) => withMergedCatalogSlugs(parsed) as ProviderConfig);

/** MODEL CACHE: the fetched models + status, one file per provider. */
export const modelCacheSchema = z.object({
  provider_id: z.string().uuid(),
  models: z.array(z.string()).default([]),
  count: z.number().int().nonnegative().default(0),
  last_fetched: z.string().nullable().default(null),
  last_status: z
    .enum(["ok", "error", "pending", "needs_key"])
    .default("pending"),
  last_error: z.string().nullable().default(null),
  // When this cache file was last written (i.e. the model list's update date).
  updated_at: z.string().nullable().default(null),
});

/** A config file holds an array of same-type provider configs. */
export const configFileSchema = z.object({
  providers: z.array(providerConfigSchema).default([]),
});

export const settingsSchema = z.object({
  refresh_interval_hours: z.number().positive(),
});

export const settingsFileSchema = settingsSchema;

/**
 * Legacy single-file schema (data.json) — kept so the repository can migrate
 * old installs into the split config + per-provider cache layout.
 */
export const legacyStoredProviderSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    description: z.string().nullable().default(null),
    type: z
      .string()
      .transform((t) => normalizeType(t))
      .pipe(z.enum(["native", "proxy", "newapi", "custom"])),
    base_url: z.string(),
    free: z.boolean().optional(),
    free_tier: z.enum(FREE_TIERS).optional(),
    aff_code: z.string().nullable().default(null),
    adapter: z.string().default(DEFAULT_ADAPTER),
    catalog_slugs: catalogSlugsSchema.optional(),
    ...legacySlugFields,
    key_enc: encryptedValueSchema.nullable().default(null),
    manual_models: z.boolean().default(false),
    icon: z.string().nullable().default(null),
    register_methods: z.array(z.string()).default([]),
    models: z.array(z.string()),
    last_fetched: z.string().nullable(),
    last_status: z.enum(["ok", "error", "pending", "needs_key"]),
    last_error: z.string().nullable(),
  })
  .transform((parsed) => withMergedCatalogSlugs(parsed));

export const legacyDataFileSchema = z.object({
  settings: settingsSchema,
  providers: z.array(legacyStoredProviderSchema),
});

/** CONFIG type: identity + connection, no model material. */
export interface ProviderConfig {
  id: string;
  name: string;
  /** Optional human description of the provider. Null = unset. */
  description: string | null;
  type: ProviderType;
  base_url: string;
  /** newapi-style referral/invite code, appended as ?aff=<code>. Optional. */
  aff_code: string | null;
  /** Upstream adapter id (see lib/upstream). Defaults to openai-compatible. */
  adapter: string;
  /** Free-tier grading: "full" (fully free) | "free" (has free tier) | "none". */
  free_tier: FreeTier;
  /** Per-source catalog slugs (adapter id → slug) for no-key model sync. */
  catalog_slugs: CatalogSlugs;
  /** Encrypted API key. Null when the provider needs no auth. */
  key_enc: EncryptedValue | null;
  /** When true, models are a built-in list; refresh must not overwrite them. */
  manual_models: boolean;
  /** Display glyph/emoji for the avatar. Null → fall back to name initial. */
  icon: string | null;
  /** Supported sign-up/login methods (NewAPI sites), e.g. ["密码注册","GitHub"]. */
  register_methods: string[];
}

/** MODEL CACHE type. */
export interface ModelCache {
  provider_id: string;
  models: string[];
  count: number;
  last_fetched: string | null;
  last_status: FetchStatus;
  last_error: string | null;
  updated_at: string | null;
}

/**
 * In-memory composition of CONFIG + MODEL CACHE. Services and routes work with
 * this shape; the repository handles the on-disk split. Never sent to client.
 */
export interface StoredProvider {
  id: string;
  name: string;
  description: string | null;
  type: ProviderType;
  base_url: string;
  aff_code: string | null;
  adapter: string;
  free_tier: FreeTier;
  catalog_slugs: CatalogSlugs;
  key_enc: EncryptedValue | null;
  manual_models: boolean;
  icon: string | null;
  register_methods: string[];
  models: string[];
  last_fetched: string | null;
  last_status: FetchStatus;
  last_error: string | null;
  /** When the model cache was last written (from the cache file). */
  updated_at: string | null;
}

/** Full administrative view, including operational refresh diagnostics. */
export interface ProviderView {
  id: string;
  name: string;
  /** Optional human description of the provider. Null = unset. */
  description: string | null;
  type: ProviderType;
  base_url: string;
  aff_code: string | null;
  adapter: string;
  /** Free-tier grading: "full" (fully free) | "free" (has free tier) | "none". */
  free_tier: FreeTier;
  /** Per-source catalog slugs (adapter id → slug) for no-key model sync. */
  catalog_slugs: CatalogSlugs;
  /** Whether an API key is stored (never the key itself). */
  has_key: boolean;
  /** When true, models are a built-in list not refreshed from upstream. */
  manual_models: boolean;
  icon: string | null;
  /** Supported sign-up/login methods (NewAPI sites). */
  register_methods: string[];
  /**
   * Where the "前往官网/站点" link points. For providers with a `site_url`
   * (official presets) it's that homepage; otherwise the base_url origin.
   * A newapi invite code is appended as ?aff=<code> when present.
   */
  invite_url: string | null;
  models: string[];
  model_count: number;
  last_fetched: string | null;
  last_status: FetchStatus;
  last_error: string | null;
  /** Model cache update date (ISO), from the per-provider cache file. */
  updated_at: string | null;
}

export interface Settings {
  refresh_interval_hours: number;
}

/** Lightweight list view: preserves counts and metadata but omits model ids. */
export type PublicProviderView = Omit<
  ProviderView,
  "has_key" | "last_fetched" | "last_status" | "last_error" | "updated_at"
>;

export type ProviderSummary = Omit<PublicProviderView, "models">;

export interface DataFile {
  settings: Settings;
  providers: StoredProvider[];
}

/** Build a fresh, empty model cache for a provider id. */
export function emptyCache(providerId: string): ModelCache {
  return {
    provider_id: providerId,
    models: [],
    count: 0,
    last_fetched: null,
    last_status: "pending",
    last_error: null,
    updated_at: null,
  };
}

/** Fields that live in ProviderConfig (identity + connection, no model cache). */
const CONFIG_KEYS = [
  "id",
  "name",
  "description",
  "type",
  "base_url",
  "aff_code",
  "adapter",
  "free_tier",
  "catalog_slugs",
  "key_enc",
  "manual_models",
  "icon",
  "register_methods",
] as const;

/** Pick just the config half out of a StoredProvider. */
function pickConfig(p: StoredProvider): ProviderConfig {
  const cfg = {} as Record<string, unknown>;
  for (const k of CONFIG_KEYS) cfg[k] = p[k];
  return cfg as unknown as ProviderConfig;
}

/** Compose a config + its (optional) model cache into a StoredProvider. */
export function composeProvider(
  cfg: ProviderConfig,
  cache: ModelCache | null
): StoredProvider {
  return {
    ...cfg,
    models: cache?.models ?? [],
    last_fetched: cache?.last_fetched ?? null,
    last_status: cache?.last_status ?? "pending",
    last_error: cache?.last_error ?? null,
    updated_at: cache?.updated_at ?? null,
  };
}

/** Split a StoredProvider into its persisted config + model-cache halves. */
export function splitProvider(p: StoredProvider): {
  config: ProviderConfig;
  cache: ModelCache;
} {
  return {
    config: pickConfig(p),
    cache: {
      provider_id: p.id,
      models: p.models,
      count: p.models.length,
      last_fetched: p.last_fetched,
      last_status: p.last_status,
      last_error: p.last_error,
      updated_at: p.updated_at,
    },
  };
}

/**
 * Build the link users click to reach the provider. Uses base_url as-is (it is
 * the canonical URL — official presets store their homepage/console there, and
 * user-added sites store their API root). A newapi invite code is appended as
 * `?aff=<code>` when present.
 */
export function buildInviteUrl(
  baseUrl: string,
  affCode: string | null
): string | null {
  const site = baseUrl.trim().replace(/\/+$/, "");
  if (!affCode) return site || null;
  const sep = site.includes("?") ? "&" : "?";
  return `${site}${sep}aff=${encodeURIComponent(affCode)}`;
}

/** Project a stored provider into its client-safe view (drops key material). */
export function toView(p: StoredProvider): ProviderView {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    type: p.type,
    base_url: p.base_url,
    aff_code: p.aff_code,
    adapter: p.adapter,
    free_tier: p.free_tier,
    catalog_slugs: p.catalog_slugs,
    has_key: p.key_enc !== null,
    manual_models: p.manual_models,
    icon: p.icon,
    register_methods: p.register_methods,
    invite_url: buildInviteUrl(p.base_url, p.aff_code),
    models: p.models,
    model_count: p.models.length,
    last_fetched: p.last_fetched,
    last_status: p.last_status,
    last_error: p.last_error,
    updated_at: p.updated_at,
  };
}

/** Fields dropped from ProviderView to form the public (non-admin) view. */
const PUBLIC_VIEW_OMIT = [
  "has_key",
  "last_fetched",
  "last_status",
  "last_error",
  "updated_at",
] as const;

/** Project a stored provider into the public list view (no diagnostics). */
export function toPublicView(p: StoredProvider): PublicProviderView {
  const view = { ...toView(p) } as Record<string, unknown>;
  for (const k of PUBLIC_VIEW_OMIT) delete view[k];
  return view as unknown as PublicProviderView;
}
