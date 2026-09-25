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

/** Zod schema mirroring the persisted encrypted value (crypto.EncryptedValue). */
const encryptedValueSchema = z.object({
  v: z.literal(1),
  iv: z.string(),
  ct: z.string(),
  tag: z.string(),
});

/** CONFIG: everything about a provider EXCEPT its model list. */
export const providerConfigSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  // Accept current + legacy type values, normalizing to a current leaf type.
  type: z
    .string()
    .transform((t) => normalizeType(t))
    .pipe(z.enum(["native", "proxy", "newapi", "custom"])),
  base_url: z.string(),
  // Official website users visit (brand homepage / console). Distinct from
  // base_url (the API endpoint) — this is what the "前往官网" link points to.
  site_url: z.string().nullable().default(null),
  aff_code: z.string().nullable().default(null),
  adapter: z.string().default(DEFAULT_ADAPTER),
  // models.dev catalog slug (api.json top-level key), used by the models-dev
  // adapter to sync this provider's model list without a key. Null = unused.
  models_dev_slug: z.string().nullable().default(null),
  // LLMRates dataset provider slug, used by the llmrates adapter to sync the
  // model list from the open pricing dataset without a key. Null = unused.
  llmrates_slug: z.string().nullable().default(null),
  // key is optional: a public relay may expose /api/pricing without auth
  key_enc: encryptedValueSchema.nullable().default(null),
  // When true, models are a built-in list and refresh must not overwrite them
  // (vendors with no usable /models endpoint, e.g. Gemini/Anthropic).
  manual_models: z.boolean().default(false),
  // Display glyph/emoji for the provider avatar. Null → fall back to initial.
  icon: z.string().nullable().default(null),
  // Supported sign-up/login methods (NewAPI /api/status), e.g. ["密码注册","GitHub"].
  register_methods: z.array(z.string()).default([]),
});

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
export const legacyStoredProviderSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: z
    .string()
    .transform((t) => normalizeType(t))
    .pipe(z.enum(["native", "proxy", "newapi", "custom"])),
  base_url: z.string(),
  site_url: z.string().nullable().default(null),
  aff_code: z.string().nullable().default(null),
  adapter: z.string().default(DEFAULT_ADAPTER),
  models_dev_slug: z.string().nullable().default(null),
  llmrates_slug: z.string().nullable().default(null),
  key_enc: encryptedValueSchema.nullable().default(null),
  manual_models: z.boolean().default(false),
  icon: z.string().nullable().default(null),
  register_methods: z.array(z.string()).default([]),
  models: z.array(z.string()),
  last_fetched: z.string().nullable(),
  last_status: z.enum(["ok", "error", "pending", "needs_key"]),
  last_error: z.string().nullable(),
});

export const legacyDataFileSchema = z.object({
  settings: settingsSchema,
  providers: z.array(legacyStoredProviderSchema),
});

/** CONFIG type: identity + connection, no model material. */
export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  base_url: string;
  /** newapi-style referral/invite code, appended as ?aff=<code>. Optional. */
  aff_code: string | null;
  /** Upstream adapter id (see lib/upstream). Defaults to openai-compatible. */
  adapter: string;
  /** Official website users visit (brand homepage / console). Null = unset. */
  site_url: string | null;
  /** models.dev catalog slug for the models-dev adapter, or null. */
  models_dev_slug: string | null;
  /** LLMRates dataset provider slug for the llmrates adapter, or null. */
  llmrates_slug: string | null;
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
  type: ProviderType;
  base_url: string;
  aff_code: string | null;
  adapter: string;
  site_url: string | null;
  models_dev_slug: string | null;
  llmrates_slug: string | null;
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
  type: ProviderType;
  base_url: string;
  aff_code: string | null;
  adapter: string;
  /** Official website users visit (brand homepage / console). Null = unset. */
  site_url: string | null;
  /** models.dev catalog slug for the models-dev adapter, or null. */
  models_dev_slug: string | null;
  /** LLMRates dataset provider slug for the llmrates adapter, or null. */
  llmrates_slug: string | null;
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

/** Compose a config + its (optional) model cache into a StoredProvider. */
export function composeProvider(
  cfg: ProviderConfig,
  cache: ModelCache | null
): StoredProvider {
  return {
    id: cfg.id,
    name: cfg.name,
    type: cfg.type,
    base_url: cfg.base_url,
    aff_code: cfg.aff_code,
    adapter: cfg.adapter,
    site_url: cfg.site_url,
    models_dev_slug: cfg.models_dev_slug,
    llmrates_slug: cfg.llmrates_slug,
    key_enc: cfg.key_enc,
    manual_models: cfg.manual_models,
    icon: cfg.icon,
    register_methods: cfg.register_methods,
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
    config: {
      id: p.id,
      name: p.name,
      type: p.type,
      base_url: p.base_url,
      aff_code: p.aff_code,
      adapter: p.adapter,
      site_url: p.site_url,
      models_dev_slug: p.models_dev_slug,
      llmrates_slug: p.llmrates_slug,
      key_enc: p.key_enc,
      manual_models: p.manual_models,
      icon: p.icon,
      register_methods: p.register_methods,
    },
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
 * Build the link users click to reach the provider. Prefers an explicit
 * `siteUrl` (the official brand homepage / console set on presets) so official
 * platforms link to their website, not their API endpoint. Falls back to the
 * base_url origin (strips /v1 etc.) for user-added sites without a site_url.
 * A newapi invite code is appended as `?aff=<code>` when present.
 */
export function buildInviteUrl(
  baseUrl: string,
  affCode: string | null,
  siteUrl?: string | null
): string | null {
  let site: string;
  const source = siteUrl && siteUrl.trim() ? siteUrl.trim() : baseUrl;
  if (siteUrl && siteUrl.trim()) {
    // An explicit site_url is used as-is (may be a deep path like /product/ark).
    site = siteUrl.trim().replace(/\/+$/, "");
  } else {
    try {
      site = new URL(source).origin;
    } catch {
      site = source.replace(/\/+$/, "");
    }
  }
  if (!affCode) return site || null;
  const sep = site.includes("?") ? "&" : "?";
  return `${site}${sep}aff=${encodeURIComponent(affCode)}`;
}

export function toPublicView(p: StoredProvider): PublicProviderView {
  const view = toView(p);
  return {
    id: view.id,
    name: view.name,
    type: view.type,
    base_url: view.base_url,
    aff_code: view.aff_code,
    adapter: view.adapter,
    site_url: view.site_url,
    models_dev_slug: view.models_dev_slug,
    llmrates_slug: view.llmrates_slug,
    manual_models: view.manual_models,
    icon: view.icon,
    register_methods: view.register_methods,
    invite_url: view.invite_url,
    models: view.models,
    model_count: view.model_count,
  };
}

/** Project a stored provider into its client-safe view (drops key material). */
export function toView(p: StoredProvider): ProviderView {
  return {
    id: p.id,
    name: p.name,
    type: p.type,
    base_url: p.base_url,
    aff_code: p.aff_code ?? null,
    adapter: p.adapter,
    site_url: p.site_url ?? null,
    models_dev_slug: p.models_dev_slug ?? null,
    llmrates_slug: p.llmrates_slug ?? null,
    has_key: p.key_enc !== null,
    manual_models: p.manual_models,
    icon: p.icon,
    register_methods: p.register_methods,
    invite_url: buildInviteUrl(p.base_url, p.aff_code ?? null, p.site_url),
    models: p.models,
    model_count: p.models.length,
    last_fetched: p.last_fetched,
    last_status: p.last_status,
    last_error: p.last_error,
    updated_at: p.updated_at,
  };
}
