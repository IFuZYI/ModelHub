import { z } from "zod";
import { listAdapters } from "../upstream";

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

// Official website URL. Optional: an empty string clears it; otherwise it must
// be a valid http(s) URL (may be a homepage or a deep console path).
const siteUrlSchema = z
  .string()
  .trim()
  .max(300)
  .refine((u) => u === "" || /^https?:\/\/.+/i.test(u), {
    message: "site_url must be empty or a valid http/https URL",
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

// models.dev catalog slug (api.json top-level key). Optional; letters, digits,
// dots, hyphens, underscores, slashes and tildes cover every known slug.
const modelsDevSlugSchema = z
  .string()
  .trim()
  .max(80)
  .regex(/^[A-Za-z0-9._~/-]*$/, "models_dev_slug has invalid characters");

// LLMRates dataset provider slug (e.g. "openai", "volcano-ark"). Optional.
const llmratesSlugSchema = z
  .string()
  .trim()
  .max(80)
  .regex(/^[A-Za-z0-9._~/-]*$/, "llmrates_slug has invalid characters");

export const createProviderSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(100),
  type: providerTypeSchema,
  base_url: baseUrlSchema,
  aff_code: affCodeSchema.optional(),
  adapter: adapterSchema.optional(),
  // Official website URL shown as the "前往官网" link (optional).
  site_url: siteUrlSchema.optional(),
  // models.dev catalog slug for the models-dev adapter (optional).
  models_dev_slug: modelsDevSlugSchema.optional(),
  // LLMRates dataset provider slug for the llmrates adapter (optional).
  llmrates_slug: llmratesSlugSchema.optional(),
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
    type: providerTypeSchema.optional(),
    base_url: baseUrlSchema.optional(),
    aff_code: affCodeSchema.optional(),
    adapter: adapterSchema.optional(),
    // site_url: empty string clears, a value sets, undefined preserves
    site_url: siteUrlSchema.optional(),
    // models_dev_slug: empty string clears, a value sets, undefined preserves
    models_dev_slug: modelsDevSlugSchema.optional(),
    // llmrates_slug: empty string clears, a value sets, undefined preserves
    llmrates_slug: llmratesSlugSchema.optional(),
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
