import { z } from "zod";
import { AppError } from "../domain/errors";
import type {
  UpstreamAdapter,
  UpstreamAttempt,
  UpstreamRequest,
} from "./types";

/**
 * newapi-style relay / OpenAI-compatible adapter.
 *
 * base_url is the site root, typically WITHOUT /v1 (e.g. https://relay.example.com),
 * but may include a version segment for some official vendors
 * (e.g. https://open.bigmodel.cn/api/paas/v4).
 * Model discovery tries, in order:
 *   1. GET {base}/api/pricing   — newapi pricing endpoint (models + prices;
 *      we keep only model ids). Usually public, no key required.
 *   2. GET {base}/v1/models     — OpenAI-standard listing (needs the key).
 *   3. GET {base}/models        — for vendors whose version lives in the base
 *      path (Gemini openai-compat, Zhipu v4, Volcengine v3, Baidu v2, ...).
 * The first attempt that yields a non-empty model list wins.
 */

// /api/pricing — newapi returns { data: [{ model_name, ... }], ... }.
const pricingSchema = z.object({
  data: z
    .array(
      z
        .object({
          model_name: z.string().optional(),
          model: z.string().optional(),
        })
        .passthrough()
    )
    .optional(),
});

// /v1/models — OpenAI standard { data: [{ id }] }.
const modelsSchema = z.object({
  data: z
    .array(z.object({ id: z.string().optional() }).passthrough())
    .optional(),
});

function dedupe(ids: (string | undefined)[]): string[] {
  return [
    ...new Set(
      ids.filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ];
}

function jsonHeaders(key: string | null): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/json" };
  if (key) h.Authorization = `Bearer ${key}`;
  return h;
}

function stripBase(baseUrl: string): string {
  // Tolerate an accidental trailing slash or /v1 the user may have pasted.
  return baseUrl.replace(/\/+$/, "").replace(/\/v1$/i, "");
}

export const openaiCompatibleAdapter: UpstreamAdapter = {
  id: "openai-compatible",
  label: "newapi / OpenAI 兼容 (pricing → /v1/models)",

  buildAttempts(baseUrl, key): UpstreamAttempt[] {
    const base = stripBase(baseUrl);

    const pricing: UpstreamRequest = {
      url: `${base}/api/pricing`,
      headers: jsonHeaders(key),
    };
    const models: UpstreamRequest = {
      url: `${base}/v1/models`,
      headers: jsonHeaders(key),
    };
    // For vendors whose version segment is already in base_url
    // (e.g. .../api/paas/v4, .../api/v3, /v1beta/openai), the OpenAI listing
    // lives at {base}/models rather than {base}/v1/models.
    const modelsAtRoot: UpstreamRequest = {
      url: `${base}/models`,
      headers: jsonHeaders(key),
    };

    const parseModels = (json: unknown): string[] => {
      const parsed = modelsSchema.safeParse(json);
      if (!parsed.success) {
        throw AppError.upstream("Unexpected /models response shape");
      }
      return dedupe((parsed.data.data ?? []).map((m) => m.id));
    };

    return [
      {
        name: "pricing",
        request: pricing,
        parse(json) {
          const parsed = pricingSchema.safeParse(json);
          if (!parsed.success) {
            throw AppError.upstream("Unexpected /api/pricing response shape");
          }
          return dedupe(
            (parsed.data.data ?? []).map((m) => m.model_name ?? m.model)
          );
        },
      },
      {
        name: "models",
        request: models,
        parse: parseModels,
      },
      {
        name: "models-root",
        request: modelsAtRoot,
        parse: parseModels,
      },
    ];
  },
};
