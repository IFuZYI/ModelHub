import { z } from "zod";
import { AppError } from "../domain/errors";
import type {
  UpstreamAdapter,
  UpstreamAttempt,
  UpstreamRequest,
} from "./types";

/**
 * LLMRates open pricing-dataset adapter.
 *
 * LLMRates.ai publishes a CC-BY-4.0 catalog of providers + models (with
 * pricing) as a single JSON file on GitHub. Like the models.dev adapter it
 * needs no API key, so it can list models for official vendors whose live
 * /v1/models endpoint is key-gated — and it covers a few vendors models.dev
 * lacks (e.g. SambaNova, Perplexity).
 *
 * A provider using this adapter carries an `llmrates_slug` (the provider slug
 * in the dataset, e.g. "openai", "sambanova", "volcano-ark"). The single
 * attempt downloads the dataset and returns that provider's active model
 * slugs (deprecated models are dropped).
 *
 * Note: the dataset's provider slugs differ from models.dev's — e.g.
 * "google-gemini" (vs "google"), "zhipu" (vs "zhipuai"),
 * "volcano-ark" (vs "volcengine").
 */

export const LLMRATES_DATASET_URL =
  "https://raw.githubusercontent.com/llmrates/llm-pricing-dataset/refs/heads/main/data/dataset.json";

// dataset.json shape (only the fields we consume): a flat models[] array where
// each model has a provider.slug, its own slug, and an optional deprecatedAt.
const datasetSchema = z.object({
  models: z.array(
    z
      .object({
        slug: z.string().optional(),
        deprecatedAt: z.string().nullable().optional(),
        provider: z
          .object({ slug: z.string().optional() })
          .passthrough()
          .optional(),
      })
      .passthrough()
  ),
});

export const llmratesAdapter: UpstreamAdapter = {
  id: "llmrates",
  label: "LLMRates 定价数据集 (dataset.json)",

  buildAttempts(_baseUrl, _key, opts): UpstreamAttempt[] {
    const slug = opts?.llmratesSlug?.trim();

    const request: UpstreamRequest = {
      url: LLMRATES_DATASET_URL,
      headers: { Accept: "application/json" },
    };

    return [
      {
        name: "llmrates",
        request,
        parse(json): string[] {
          if (!slug) {
            throw AppError.upstream(
              "llmrates adapter requires an llmrates_slug"
            );
          }
          const parsed = datasetSchema.safeParse(json);
          if (!parsed.success) {
            throw AppError.upstream("Unexpected LLMRates dataset.json shape");
          }
          const ids = new Set<string>();
          let matchedProvider = false;
          for (const m of parsed.data.models) {
            if (m.provider?.slug !== slug) continue;
            matchedProvider = true;
            // Skip deprecated models so the list reflects what's live.
            if (m.deprecatedAt) continue;
            if (m.slug) ids.add(m.slug);
          }
          if (!matchedProvider) {
            throw AppError.upstream(
              `LLMRates dataset has no provider slug "${slug}"`
            );
          }
          return [...ids];
        },
      },
    ];
  },
};
