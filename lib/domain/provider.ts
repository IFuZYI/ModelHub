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
export type FetchStatus = "ok" | "error" | "pending";

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
  aff_code: z.string().nullable().default(null),
  adapter: z.string().default(DEFAULT_ADAPTER),
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
  last_status: z.enum(["ok", "error", "pending"]).default("pending"),
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
  aff_code: z.string().nullable().default(null),
  adapter: z.string().default(DEFAULT_ADAPTER),
  key_enc: encryptedValueSchema.nullable().default(null),
  manual_models: z.boolean().default(false),
  icon: z.string().nullable().default(null),
  register_methods: z.array(z.string()).default([]),
  models: z.array(z.string()),
  last_fetched: z.string().nullable(),
  last_status: z.enum(["ok", "error", "pending"]),
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

/** Client-facing view: no key material. */
export interface ProviderView {
  id: string;
  name: string;
  type: ProviderType;
  base_url: string;
  aff_code: string | null;
  adapter: string;
  /** Whether an API key is stored (never the key itself). */
  has_key: boolean;
  /** When true, models are a built-in list not refreshed from upstream. */
  manual_models: boolean;
  icon: string | null;
  /** Supported sign-up/login methods (NewAPI sites). */
  register_methods: string[];
  /** base_url origin + ?aff=<code> when an invite code is set, else the origin. */
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
 * Build the site URL for a provider, appending the newapi invite code as
 * `?aff=<code>` when present. Uses the base_url's origin (strips /v1 etc.),
 * falling back to the raw base_url if it isn't a parseable URL.
 */
export function buildInviteUrl(
  baseUrl: string,
  affCode: string | null
): string | null {
  let site: string;
  try {
    site = new URL(baseUrl).origin;
  } catch {
    site = baseUrl.replace(/\/+$/, "");
  }
  if (!affCode) return site || null;
  const sep = site.includes("?") ? "&" : "?";
  return `${site}${sep}aff=${encodeURIComponent(affCode)}`;
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
    has_key: p.key_enc !== null,
    manual_models: p.manual_models,
    icon: p.icon,
    register_methods: p.register_methods,
    invite_url: buildInviteUrl(p.base_url, p.aff_code ?? null),
    models: p.models,
    model_count: p.models.length,
    last_fetched: p.last_fetched,
    last_status: p.last_status,
    last_error: p.last_error,
    updated_at: p.updated_at,
  };
}
