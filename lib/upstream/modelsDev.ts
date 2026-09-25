import { z } from "zod";
import { AppError } from "../domain/errors";
import type {
  UpstreamAdapter,
  UpstreamAttempt,
  UpstreamRequest,
} from "./types";

/**
 * models.dev adapter.
 *
 * models.dev publishes a single, community-maintained catalog of providers and
 * their model ids at https://models.dev/api.json. Unlike the OpenAI-compatible
 * adapter it needs no API key and works for vendors whose live /v1/models
 * endpoint is unavailable or key-gated (Gemini, Anthropic, cloud platforms).
 *
 * A provider using this adapter carries a `models_dev_slug` (the top-level key
 * in api.json, e.g. "openai", "google", "amazon-bedrock"). The single attempt
 * downloads the catalog and returns that slug's model ids.
 */

export const MODELS_DEV_API_URL = "https://models.dev/api.json";

// api.json shape: { <slug>: { id, name, models: { <modelId>: { id, ... } } } }.
const catalogSchema = z.record(
  z.string(),
  z
    .object({
      models: z.record(z.string(), z.unknown()).optional(),
    })
    .passthrough()
);

export const modelsDevAdapter: UpstreamAdapter = {
  id: "models-dev",
  label: "models.dev 目录 (api.json)",

  buildAttempts(_baseUrl, _key, opts): UpstreamAttempt[] {
    const slug = opts?.modelsDevSlug?.trim();

    const request: UpstreamRequest = {
      url: MODELS_DEV_API_URL,
      headers: { Accept: "application/json" },
    };

    return [
      {
        name: "models.dev",
        request,
        parse(json): string[] {
          if (!slug) {
            throw AppError.upstream(
              "models.dev adapter requires a models_dev_slug"
            );
          }
          const parsed = catalogSchema.safeParse(json);
          if (!parsed.success) {
            throw AppError.upstream("Unexpected models.dev api.json shape");
          }
          const entry = parsed.data[slug];
          if (!entry) {
            throw AppError.upstream(
              `models.dev has no provider slug "${slug}"`
            );
          }
          return Object.keys(entry.models ?? {});
        },
      },
    ];
  },
};
