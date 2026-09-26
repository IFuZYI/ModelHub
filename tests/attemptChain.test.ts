import { describe, it, expect } from "vitest";
import { buildModelFetchAttempts } from "@/lib/upstream";
import { MODELS_DEV_API_URL } from "@/lib/upstream/modelsDev";
import { LITELLM_CATALOG_URL } from "@/lib/upstream/litellm";

describe("buildModelFetchAttempts (catalog fallbacks)", () => {
  it("orders catalogs: spullara → models-dev → litellm after live API", () => {
    const attempts = buildModelFetchAttempts({
      adapter: "openai-compatible",
      baseUrl: "https://api.example.com",
      key: "sk-1",
      catalogSlugs: {
        spullara: "openai",
        "models-dev": "openai",
        litellm: "openai",
      },
    });
    const names = attempts.map((a) => a.name);
    // openai-compatible contributes pricing / models / models-root first
    expect(names.slice(0, 3)).toEqual(["pricing", "models", "models-root"]);
    // then the no-key catalogs as fallbacks, most-authoritative first
    expect(names.slice(-3)).toEqual(["spullara", "models-dev", "litellm"]);
  });

  it("omits a catalog when its slug is absent", () => {
    const attempts = buildModelFetchAttempts({
      adapter: "openai-compatible",
      baseUrl: "https://api.example.com",
      key: null,
      catalogSlugs: { "models-dev": "openai" },
    });
    const names = attempts.map((a) => a.name);
    expect(names).toContain("models-dev");
    expect(names).not.toContain("litellm");
    expect(names).not.toContain("spullara");
  });

  it("does not duplicate the primary adapter as a fallback", () => {
    const attempts = buildModelFetchAttempts({
      adapter: "models-dev",
      baseUrl: "",
      key: null,
      catalogSlugs: { "models-dev": "openai", litellm: "openai" },
    });
    const modelsDevHits = attempts.filter(
      (a) => a.request.url === MODELS_DEV_API_URL
    );
    // primary is models-dev; it must appear exactly once (not re-appended)
    expect(modelsDevHits).toHaveLength(1);
    // litellm is still appended as an extra fallback
    expect(attempts.map((a) => a.name)).toContain("litellm");
    expect(attempts.at(-1)!.request.url).toBe(LITELLM_CATALOG_URL);
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
