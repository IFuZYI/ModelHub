import { describe, it, expect } from "vitest";
import { llmratesAdapter, LLMRATES_DATASET_URL } from "@/lib/upstream/llmrates";
import { getAdapter, listAdapters } from "@/lib/upstream";

// A trimmed dataset.json-shaped fixture.
const dataset = {
  meta: { name: "x" },
  providers: [{ slug: "openai" }, { slug: "sambanova" }],
  models: [
    { slug: "gpt-4o", deprecatedAt: null, provider: { slug: "openai" } },
    { slug: "o3", deprecatedAt: null, provider: { slug: "openai" } },
    {
      slug: "gpt-old",
      deprecatedAt: "2025-01-01T00:00:00Z",
      provider: { slug: "openai" },
    },
    {
      slug: "meta-llama-3-3-70b-instruct",
      deprecatedAt: null,
      provider: { slug: "sambanova" },
    },
  ],
};

describe("llmratesAdapter", () => {
  it("is registered and resolvable by id", () => {
    expect(listAdapters().some((a) => a.id === "llmrates")).toBe(true);
    expect(getAdapter("llmrates").id).toBe("llmrates");
  });

  it("hits the dataset url once", () => {
    const attempts = llmratesAdapter.buildAttempts("", null, {
      llmratesSlug: "openai",
    });
    expect(attempts).toHaveLength(1);
    expect(attempts[0].request.url).toBe(LLMRATES_DATASET_URL);
  });

  it("returns active (non-deprecated) model slugs for the provider", () => {
    const [attempt] = llmratesAdapter.buildAttempts("", null, {
      llmratesSlug: "openai",
    });
    expect(attempt.parse(dataset).sort()).toEqual(["gpt-4o", "o3"]);
  });

  it("covers vendors models.dev lacks (sambanova)", () => {
    const [attempt] = llmratesAdapter.buildAttempts("", null, {
      llmratesSlug: "sambanova",
    });
    expect(attempt.parse(dataset)).toEqual(["meta-llama-3-3-70b-instruct"]);
  });

  it("throws when the slug is missing", () => {
    const [attempt] = llmratesAdapter.buildAttempts("", null, {});
    expect(() => attempt.parse(dataset)).toThrow(/llmrates_slug/);
  });

  it("throws when the slug is absent from the dataset", () => {
    const [attempt] = llmratesAdapter.buildAttempts("", null, {
      llmratesSlug: "nope",
    });
    expect(() => attempt.parse(dataset)).toThrow(/nope/);
  });

  it("throws on a malformed dataset shape", () => {
    const [attempt] = llmratesAdapter.buildAttempts("", null, {
      llmratesSlug: "openai",
    });
    expect(() => attempt.parse({ nope: true })).toThrow(/LLMRates/);
  });
});
