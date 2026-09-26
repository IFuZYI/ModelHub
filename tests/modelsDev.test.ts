import { describe, it, expect } from "vitest";
import { modelsDevAdapter, MODELS_DEV_API_URL } from "@/lib/upstream/modelsDev";
import { getAdapter, listAdapters } from "@/lib/upstream";

// A trimmed api.json-shaped fixture.
const catalog = {
  openai: {
    id: "openai",
    name: "OpenAI",
    models: { "gpt-4o": { id: "gpt-4o" }, o3: { id: "o3" } },
  },
  empty: { id: "empty", name: "Empty" },
};

describe("modelsDevAdapter", () => {
  it("is registered and resolvable by id", () => {
    expect(listAdapters().some((a) => a.id === "models-dev")).toBe(true);
    expect(getAdapter("models-dev").id).toBe("models-dev");
  });

  it("hits the models.dev api.json url once", () => {
    const attempts = modelsDevAdapter.buildAttempts("", null, {
      catalogSlug: "openai",
    });
    expect(attempts).toHaveLength(1);
    expect(attempts[0].request.url).toBe(MODELS_DEV_API_URL);
  });

  it("returns the model ids for the given slug", () => {
    const [attempt] = modelsDevAdapter.buildAttempts("", null, {
      catalogSlug: "openai",
    });
    expect(attempt.parse(catalog).sort()).toEqual(["gpt-4o", "o3"]);
  });

  it("returns an empty list for a slug with no models (falls through)", () => {
    const [attempt] = modelsDevAdapter.buildAttempts("", null, {
      catalogSlug: "empty",
    });
    expect(attempt.parse(catalog)).toEqual([]);
  });

  it("throws when the slug is missing", () => {
    const [attempt] = modelsDevAdapter.buildAttempts("", null, {});
    expect(() => attempt.parse(catalog)).toThrow(/requires a slug/);
  });

  it("throws when the slug is absent from the catalog", () => {
    const [attempt] = modelsDevAdapter.buildAttempts("", null, {
      catalogSlug: "does-not-exist",
    });
    expect(() => attempt.parse(catalog)).toThrow(/does-not-exist/);
  });

  it("throws on a malformed catalog shape", () => {
    const [attempt] = modelsDevAdapter.buildAttempts("", null, {
      catalogSlug: "openai",
    });
    expect(() => attempt.parse([1, 2, 3])).toThrow(/models.dev/);
  });
});
