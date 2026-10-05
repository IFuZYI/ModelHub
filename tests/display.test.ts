import { describe, it, expect } from "vitest";
import {
  modelDedupeKey,
  distinctModelCount,
  modelVendor,
  vendorLabel,
  normalizeVendorKey,
  filterHitsByCategory,
  filterHitsByFreeTier,
  freeTierLabel,
  FREE_TIER_FILTERS,
} from "../app/lib/display";
import { toPublicView } from "@/lib/domain/provider";
import type { StoredProvider } from "@/lib/domain/provider";

describe("modelDedupeKey", () => {
  it("strips a provider/ prefix and lowercases", () => {
    expect(modelDedupeKey("openai/gpt-4o")).toBe("gpt-4o");
    expect(modelDedupeKey("gpt-4o")).toBe("gpt-4o");
    expect(modelDedupeKey("GPT-4o")).toBe("gpt-4o");
  });

  it("keeps only the last path segment", () => {
    expect(modelDedupeKey("meta-llama/Llama-3.3-70B-Instruct")).toBe(
      "llama-3.3-70b-instruct"
    );
    expect(modelDedupeKey("accounts/fireworks/models/deepseek-v3")).toBe(
      "deepseek-v3"
    );
  });

  it("trims whitespace", () => {
    expect(modelDedupeKey("  gpt-4o  ")).toBe("gpt-4o");
  });
});

describe("distinctModelCount", () => {
  it("dedupes the same model across providers", () => {
    const n = distinctModelCount([
      ["openai/gpt-4o", "openai/gpt-4o-mini"], // aggregator A
      ["gpt-4o", "gpt-4o-mini"], // official OpenAI
    ]);
    expect(n).toBe(2); // gpt-4o + gpt-4o-mini, not 4
  });

  it("counts genuinely distinct models separately", () => {
    const n = distinctModelCount([
      ["gpt-4o", "claude-sonnet-4"],
      ["deepseek-chat"],
    ]);
    expect(n).toBe(3);
  });

  it("dedupes vendor-path variants against bare names", () => {
    const n = distinctModelCount([
      ["meta-llama/Llama-3.3-70B-Instruct"],
      ["Llama-3.3-70B-Instruct"],
    ]);
    expect(n).toBe(1);
  });

  it("ignores empty entries", () => {
    expect(distinctModelCount([[], [""], ["  "]])).toBe(0);
  });
});

describe("modelVendor", () => {
  it("uses the vendor/ prefix when present", () => {
    expect(modelVendor("openai/gpt-4o")).toBe("openai");
    expect(modelVendor("meta-llama/Llama-3.3-70B")).toBe("meta");
    expect(modelVendor("anthropic/claude-sonnet-4")).toBe("anthropic");
  });

  it("normalizes noisy aggregator vendor prefixes to a canonical key", () => {
    expect(modelVendor("~openai/gpt-4o")).toBe("openai");
    expect(modelVendor("~anthropic/claude-3")).toBe("anthropic");
    expect(modelVendor("z-ai/glm-4.6")).toBe("zhipu");
    expect(modelVendor("~z-ai/glm-4.6")).toBe("zhipu");
    expect(modelVendor("x-ai/grok-4")).toBe("xai");
    expect(modelVendor("mistralai/Mistral-7B")).toBe("mistral");
    expect(modelVendor("deepseek-ai/DeepSeek-V3")).toBe("deepseek");
    expect(modelVendor("moonshotai/Kimi-K2")).toBe("moonshot");
    expect(modelVendor("~google/gemini-2.5-pro")).toBe("google");
  });

  it("infers vendor from bare model names", () => {
    expect(modelVendor("gpt-4o")).toBe("openai");
    expect(modelVendor("o3")).toBe("openai");
    expect(modelVendor("claude-3-5-sonnet")).toBe("anthropic");
    expect(modelVendor("gemini-2.5-pro")).toBe("google");
    expect(modelVendor("grok-4")).toBe("xai");
    expect(modelVendor("deepseek-chat")).toBe("deepseek");
    expect(modelVendor("qwen-max")).toBe("qwen");
    expect(modelVendor("glm-4-plus")).toBe("zhipu");
    expect(modelVendor("moonshot-v1-8k")).toBe("moonshot");
    expect(modelVendor("mistral-large-latest")).toBe("mistral");
  });

  it("falls back to 其他 for unknown names", () => {
    expect(modelVendor("some-random-model")).toBe("其他");
  });
});

describe("toPublicView", () => {
  const provider: StoredProvider = {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Example",
    description: null,
    type: "native",
    base_url: "https://example.com",
    aff_code: null,
    adapter: "openai-compatible",
    free_tier: "none",
    catalog_slugs: {},
    key_enc: null,
    manual_models: false,
    icon: null,
    register_methods: [],
    models: ["gpt-4o"],
    last_fetched: "2026-09-25T06:01:27.000Z",
    last_status: "needs_key",
    last_error: "pricing: HTTP 401 Unauthorized: secret upstream detail",
    updated_at: "2026-09-25T01:49:14.000Z",
  };

  it("omits operational diagnostics and credentials from public views", () => {
    const view = toPublicView(provider);
    expect(view).not.toHaveProperty("last_error");
    expect(view).not.toHaveProperty("last_status");
    expect(view).not.toHaveProperty("last_fetched");
    expect(view).not.toHaveProperty("updated_at");
    expect(view).not.toHaveProperty("has_key");
  });

  it("carries the free-tier grade through to the public view", () => {
    expect(toPublicView({ ...provider, free_tier: "full" }).free_tier).toBe(
      "full"
    );
    expect(toPublicView({ ...provider, free_tier: "free" }).free_tier).toBe(
      "free"
    );
    expect(toPublicView({ ...provider, free_tier: "none" }).free_tier).toBe(
      "none"
    );
  });
});

describe("vendorLabel", () => {
  it("maps known vendor keys to human labels", () => {
    expect(vendorLabel("openai")).toBe("OpenAI");
    expect(vendorLabel("qwen")).toBe("通义千问");
    expect(vendorLabel("zhipu")).toBe("智谱 GLM");
  });

  it("passes through unknown keys unchanged", () => {
    expect(vendorLabel("acme")).toBe("acme");
  });
});

describe("normalizeVendorKey", () => {
  it("strips ~ routing markers and collapses synonyms", () => {
    expect(normalizeVendorKey("~openai")).toBe("openai");
    expect(normalizeVendorKey("z-ai")).toBe("zhipu");
    expect(normalizeVendorKey("x-ai")).toBe("xai");
    expect(normalizeVendorKey("meta-llama")).toBe("meta");
    expect(normalizeVendorKey("mistralai")).toBe("mistral");
    expect(normalizeVendorKey("openai")).toBe("openai");
  });
});

describe("filterHitsByCategory", () => {
  const hits = [
    { id: "a", type: "native" as const },
    { id: "b", type: "proxy" as const },
    { id: "c", type: "newapi" as const },
    { id: "d", type: "custom" as const },
  ];

  it("returns everything for the 'all' chip", () => {
    expect(filterHitsByCategory(hits, "all").map((h) => h.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("keeps native/proxy for 'official' (官方)", () => {
    expect(filterHitsByCategory(hits, "official").map((h) => h.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("keeps newapi/custom for 'other' (其他)", () => {
    expect(filterHitsByCategory(hits, "other").map((h) => h.id)).toEqual([
      "c",
      "d",
    ]);
  });

  it("returns an empty list when nothing matches, not the unfiltered list", () => {
    expect(
      filterHitsByCategory([{ id: "x", type: "newapi" as const }], "official")
    ).toEqual([]);
  });
});

describe("freeTierLabel", () => {
  it("maps grades to the site's vocabulary (console + card badges)", () => {
    expect(freeTierLabel("full")).toBe("ALL FREE");
    expect(freeTierLabel("free")).toBe("FREE");
    expect(freeTierLabel("none")).toBe("NO（付费）");
  });
});

describe("FREE_TIER_FILTERS", () => {
  it("offers all four selections, freest grade first", () => {
    expect(FREE_TIER_FILTERS).toEqual(["all", "full", "free", "none"]);
  });
});

describe("filterHitsByFreeTier", () => {
  const hits = [
    { id: "a", free_tier: "full" as const },
    { id: "b", free_tier: "free" as const },
    { id: "c", free_tier: "none" as const },
  ];

  it("returns everything for the 'all' chip", () => {
    expect(filterHitsByFreeTier(hits, "all").map((h) => h.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("keeps only the selected grade — grades are exclusive", () => {
    expect(filterHitsByFreeTier(hits, "full").map((h) => h.id)).toEqual(["a"]);
    expect(filterHitsByFreeTier(hits, "free").map((h) => h.id)).toEqual(["b"]);
    expect(filterHitsByFreeTier(hits, "none").map((h) => h.id)).toEqual(["c"]);
  });

  it("returns an empty list when nothing matches, not the unfiltered list", () => {
    expect(
      filterHitsByFreeTier([{ id: "x", free_tier: "none" as const }], "full")
    ).toEqual([]);
  });
});
