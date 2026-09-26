import { z } from "zod";
import { createCatalogAdapter, catalogParse } from "./catalogAdapter";

/**
 * models.dev adapter — community-maintained catalog at
 * https://models.dev/api.json, keyed by provider slug (e.g. "openai",
 * "google", "amazon-bedrock"). No API key needed, so it lists models for
 * vendors whose live /v1/models is gated (Gemini, Anthropic, cloud platforms).
 */

export const MODELS_DEV_API_URL = "https://models.dev/api.json";

// api.json shape: { <slug>: { models: { <modelId>: {...} } } }.
const catalogSchema = z.record(
  z.string(),
  z.object({ models: z.record(z.string(), z.unknown()).optional() }).passthrough()
);

export const modelsDevAdapter = createCatalogAdapter({
  id: "models-dev",
  label: "models.dev 目录 (api.json)",
  url: () => MODELS_DEV_API_URL,
  fromJson(json, slug) {
    const catalog = catalogParse(catalogSchema, json, "models.dev api.json");
    const entry = catalog[slug];
    if (!entry) {
      throw new Error(`models.dev has no provider slug "${slug}"`);
    }
    return Object.keys(entry.models ?? {});
  },
});
