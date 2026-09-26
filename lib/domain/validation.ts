import { z } from "zod";
import { listAdapters } from "../upstream";
import { FREE_TIERS } from "./provider";
import {
  usernameSchema,
  passwordSchema,
  emailSchema,
  roleSchema,
} from "./user";

/** Shared validation schemas for provider payloads. */

export const providerTypeSchema = z.enum([
  "native",
  "proxy",
  "newapi",
  "custom",
]);

const baseUrlSchema = z
  .string()
  .trim()
  .url("base_url must be a valid URL")
  .refine((u) => /^https?:\/\//i.test(u), {
    message: "base_url must use http or https",
  });

// newapi invite/referral code — appended as ?aff=<code>. Optional.
const affCodeSchema = z
  .string()
  .trim()
  .max(120)
  .regex(
    /^[A-Za-z0-9_-]*$/,
    "aff_code may contain only letters, digits, - and _"
  );

// Display glyph/emoji for the avatar OR icon URL.
const iconSchema = z.string().trim().max(300);

// Sign-up / login method labels (NewAPI sites). Optional.
const registerMethodsSchema = z.array(z.string().trim().min(1).max(40)).max(20);

// Adapter id must match a registered upstream adapter.
const adapterSchema = z
  .string()
  .refine((id) => listAdapters().some((a) => a.id === id), {
    message: "unknown adapter",
  });

// Catalog value: either a provider slug (models.dev key, LiteLLM provider,
// spullara vendor name) or a full http(s) URL to a compatible model list.
// Slug charset covers every known slug; URLs are allowed up to 300 chars.
const catalogSlugValue = z
  .string()
  .trim()
  .max(300)
  .refine(
    (v) => /^https?:\/\/.+/i.test(v) || /^[A-Za-z0-9._~/-]*$/.test(v),
    "catalog slug must be a provider slug or an http/https URL"
  );

// catalog_slugs: adapter id → slug. Adapter ids are validated in the service.
const catalogSlugsSchema = z.record(z.string(), catalogSlugValue);

// Optional provider description shown on the detail page.
const descriptionSchema = z.string().trim().max(500);

export const createProviderSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(100),
  description: descriptionSchema.optional(),
  type: providerTypeSchema,
  base_url: baseUrlSchema,
  aff_code: affCodeSchema.optional(),
  adapter: adapterSchema.optional(),
  // Whether this provider offers a free tier / free tokens (retired; use free_tier).
  free: z.boolean().optional(),
  // Free-tier grading: "full" | "free" | "none".
  free_tier: z.enum(FREE_TIERS).optional(),
  // Per-source catalog slugs (adapter id → slug) for no-key model sync.
  catalog_slugs: catalogSlugsSchema.optional(),
  // key is OPTIONAL: relays that expose a public /api/pricing need no auth.
  key: z.string().trim().max(500).optional(),
  // Built-in model list to seed a preset-based provider (optional).
  models: z.array(z.string().trim().min(1).max(200)).max(500).optional(),
  // When true, the seed model list is authoritative and refresh won't clear it.
  manual_models: z.boolean().optional(),
  // Display glyph/emoji for the avatar (optional).
  icon: iconSchema.optional(),
  // Sign-up / login methods (NewAPI sites, optional).
  register_methods: registerMethodsSchema.optional(),
});

export const updateProviderSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    // description: empty string clears, a value sets, undefined preserves
    description: descriptionSchema.optional(),
    type: providerTypeSchema.optional(),
    base_url: baseUrlSchema.optional(),
    aff_code: affCodeSchema.optional(),
    adapter: adapterSchema.optional(),
    // free: retired boolean toggle, still accepted for back-compat
    free: z.boolean().optional(),
    // free_tier: set the free-tier grade ("full" | "free" | "none")
    free_tier: z.enum(FREE_TIERS).optional(),
    // catalog_slugs: replaces the stored map when provided
    catalog_slugs: catalogSlugsSchema.optional(),
    // Empty key explicitly clears the stored credential; omission preserves it.
    key: z.string().trim().max(500).optional(),
    // icon: empty string clears, a value sets, undefined leaves unchanged
    icon: iconSchema.optional(),
    // replace the stored sign-up methods list when provided
    register_methods: registerMethodsSchema.optional(),
    // manual model list edits (custom / newapi providers)
    models: z.array(z.string().trim().min(1).max(200)).max(500).optional(),
    manual_models: z.boolean().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, {
    message: "at least one field is required",
  });

export type CreateProviderInput = z.infer<typeof createProviderSchema>;
export type UpdateProviderInput = z.infer<typeof updateProviderSchema>;

// ---- auth / user payloads (v0.3) ----

export const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

export const registerSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  email: emailSchema.optional(),
});

/** Admin-created user. Role defaults to "user" when omitted. */
export const adminCreateUserSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  email: emailSchema.optional(),
  role: roleSchema.optional(),
});

/** Admin edits to a user; every field optional. */
export const adminUpdateUserSchema = z
  .object({
    password: passwordSchema.optional(),
    email: emailSchema.nullable().optional(),
    role: roleSchema.optional(),
    status: z.enum(["active", "disabled"]).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, {
    message: "at least one field is required",
  });

/** Self password change. */
export const changePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: passwordSchema,
});

// ---- settings payload (v0.3) ----

export const settingsUpdateSchema = z
  .object({
    registration_enabled: z.boolean().optional(),
    email_verification_required: z.boolean().optional(),
    email_domain_whitelist: z.array(z.string().trim().min(1).max(255)).max(50).optional(),
    personal_pages_enabled: z.boolean().optional(),
    key_share_enabled: z.boolean().optional(),
    key_share_consumers: z.enum(["admin", "everyone"]).optional(),
    smtp_host: z.string().trim().max(255).optional(),
    smtp_port: z.coerce.number().int().min(1).max(65535).optional(),
    smtp_username: z.string().trim().max(255).optional(),
    smtp_password: z.string().max(500).optional(),
    smtp_from: z.string().trim().max(255).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, {
    message: "at least one field is required",
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type AdminCreateUserInput = z.infer<typeof adminCreateUserSchema>;
export type AdminUpdateUserInput = z.infer<typeof adminUpdateUserSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type SettingsUpdateInput = z.infer<typeof settingsUpdateSchema>;

// ---- user-provider payloads (v0.3, per-user mounts) ----

export const createUserProviderSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(100),
  description: descriptionSchema.optional(),
  type: providerTypeSchema,
  base_url: baseUrlSchema,
  free_tier: z.enum(FREE_TIERS).optional(),
  icon: iconSchema.optional(),
  aff_code: affCodeSchema.optional(),
  adapter: adapterSchema.optional(),
  catalog_slugs: catalogSlugsSchema.optional(),
  key: z.string().trim().max(500).optional(),
  models: z.array(z.string().trim().min(1).max(200)).max(500).optional(),
  manual_models: z.boolean().optional(),
  register_methods: registerMethodsSchema.optional(),
});

export const updateUserProviderSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: descriptionSchema.optional(),
    type: providerTypeSchema.optional(),
    base_url: baseUrlSchema.optional(),
    free_tier: z.enum(FREE_TIERS).optional(),
    icon: iconSchema.optional(),
    aff_code: affCodeSchema.optional(),
    adapter: adapterSchema.optional(),
    catalog_slugs: catalogSlugsSchema.optional(),
    key: z.string().trim().max(500).optional(),
    models: z.array(z.string().trim().min(1).max(200)).max(500).optional(),
    manual_models: z.boolean().optional(),
    register_methods: registerMethodsSchema.optional(),
  })
  .refine((o) => Object.keys(o).length > 0, {
    message: "at least one field is required",
  });

export type CreateUserProviderInput = z.infer<typeof createUserProviderSchema>;
export type UpdateUserProviderInput = z.infer<typeof updateUserProviderSchema>;
