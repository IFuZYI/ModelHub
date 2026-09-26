import { describe, it, expect } from "vitest";
import { litellmAdapter, LITELLM_CATALOG_URL } from "@/lib/upstream/litellm";
import { getAdapter, listAdapters } from "@/lib/upstream";

// A trimmed model_prices_and_context_window.json-shaped fixture.
const catalog = {
  sample_spec: { litellm_provider: "docs" },
  "gpt-4o": { litellm_provider: "openai" },
  o3: { litellm_provider: "openai" },
  "ft:gpt-4o-2024-08-06": { litellm_provider: "openai" }, // fine-tune stub
  "together-ai-8b": { litellm_provider: "together_ai" },
  "vercel_ai_gateway/openai/gpt-4o": { litellm_provider: "vercel_ai_gateway" },
};

describe("litellmAdapter", () => {
  it("is registered and resolvable by id", () => {
    expect(listAdapters().some((a) => a.id === "litellm")).toBe(true);
    expect(getAdapter("litellm").id).toBe("litellm");
  });

  it("hits the catalog url once", () => {
    const attempts = litellmAdapter.buildAttempts("", null, {
      catalogSlug: "openai",
    });
    expect(attempts).toHaveLength(1);
    expect(attempts[0].request.url).toBe(LITELLM_CATALOG_URL);
  });

  it("returns provider models, dropping sample_spec and ft: stubs", () => {
    const [attempt] = litellmAdapter.buildAttempts("", null, {
      catalogSlug: "openai",
    });
    expect(attempt.parse(catalog).sort()).toEqual(["gpt-4o", "o3"]);
  });

  it("strips the leading <slug>/ path segment", () => {
    const [attempt] = litellmAdapter.buildAttempts("", null, {
      catalogSlug: "vercel_ai_gateway",
    });
    expect(attempt.parse(catalog)).toEqual(["openai/gpt-4o"]);
  });

  it("throws when the slug is missing or absent", () => {
    const [a] = litellmAdapter.buildAttempts("", null, {});
    expect(() => a.parse(catalog)).toThrow(/requires a slug/);
    const [b] = litellmAdapter.buildAttempts("", null, {
      catalogSlug: "nope",
    });
    expect(() => b.parse(catalog)).toThrow(/nope/);
  });
});
