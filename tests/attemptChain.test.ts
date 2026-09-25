import { describe, it, expect } from "vitest";
import { buildModelFetchAttempts } from "@/lib/upstream";
import { MODELS_DEV_API_URL } from "@/lib/upstream/modelsDev";
import { LLMRATES_DATASET_URL } from "@/lib/upstream/llmrates";

describe("buildModelFetchAttempts (catalog fallbacks)", () => {
  it("puts the live API first, then models.dev, then LLMRates", () => {
    const attempts = buildModelFetchAttempts({
      adapter: "openai-compatible",
      baseUrl: "https://api.example.com",
      key: "sk-1",
      modelsDevSlug: "openai",
      llmratesSlug: "openai",
    });
    const names = attempts.map((a) => a.name);
    // openai-compatible contributes pricing / models / models-root first
    expect(names.slice(0, 3)).toEqual(["pricing", "models", "models-root"]);
    // then the no-key catalogs as fallbacks, in order
    expect(names.slice(-2)).toEqual(["models.dev", "llmrates"]);
    expect(attempts.at(-2)!.request.url).toBe(MODELS_DEV_API_URL);
    expect(attempts.at(-1)!.request.url).toBe(LLMRATES_DATASET_URL);
  });

  it("omits a catalog when its slug is absent", () => {
    const attempts = buildModelFetchAttempts({
      adapter: "openai-compatible",
      baseUrl: "https://api.example.com",
      key: null,
      modelsDevSlug: "openai",
    });
    const names = attempts.map((a) => a.name);
    expect(names).toContain("models.dev");
    expect(names).not.toContain("llmrates");
  });

  it("does not duplicate the primary adapter as a fallback", () => {
    const attempts = buildModelFetchAttempts({
      adapter: "models-dev",
      baseUrl: "",
      key: null,
      modelsDevSlug: "openai",
      llmratesSlug: "sambanova",
    });
    const modelsDevHits = attempts.filter(
      (a) => a.request.url === MODELS_DEV_API_URL
    );
    // primary is models-dev; it must appear exactly once (not re-appended)
    expect(modelsDevHits).toHaveLength(1);
    // llmrates is still appended as an extra fallback
    expect(attempts.map((a) => a.name)).toContain("llmrates");
  });

  it("returns only the live attempts when no slugs are set", () => {
    const attempts = buildModelFetchAttempts({
      adapter: "openai-compatible",
      baseUrl: "https://api.example.com",
      key: "sk-1",
    });
    expect(attempts.map((a) => a.name)).toEqual([
      "pricing",
      "models",
      "models-root",
    ]);
  });
});
