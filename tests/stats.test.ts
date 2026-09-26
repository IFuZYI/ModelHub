import { describe, it, expect } from "vitest";
import { deriveStat } from "@/lib/domain/stats";
import { normalizeBaseUrl } from "@/lib/domain/provider";

describe("normalizeBaseUrl", () => {
  it("collapses scheme case, trailing slash, /v1, and default ports", () => {
    const canonical = "https://api.example.com";
    expect(normalizeBaseUrl("https://api.example.com")).toBe(canonical);
    expect(normalizeBaseUrl("https://api.example.com/")).toBe(canonical);
    expect(normalizeBaseUrl("https://API.example.com/v1")).toBe(canonical);
    expect(normalizeBaseUrl("https://api.example.com:443/v1/")).toBe(canonical);
    expect(normalizeBaseUrl("https://api.example.com/v1?x=1#f")).toBe(canonical);
  });

  it("keeps a non-default port and a deeper path", () => {
    expect(normalizeBaseUrl("http://host:8080/base/")).toBe(
      "http://host:8080/base"
    );
  });

  it("falls back to a stable string on unparseable input", () => {
    expect(normalizeBaseUrl("  NotAUrl/v1/  ")).toBe("notaurl");
  });
});

describe("deriveStat", () => {
  it("takes most-used name/icon and most-voted type/free_tier with tallies", () => {
    const derived = deriveStat([
      { name: "Cat API", icon: "a.png", type: "newapi", free_tier: "free" },
      { name: "Cat API", icon: "b.png", type: "newapi", free_tier: "none" },
      { name: "Other", icon: "a.png", type: "proxy", free_tier: "free" },
    ]);
    expect(derived.name).toBe("Cat API"); // 2 vs 1
    expect(derived.icon).toBe("a.png"); // 2 vs 1
    expect(derived.type).toBe("newapi"); // 2 vs 1
    expect(derived.free_tier).toBe("free"); // 2 vs 1
    expect(derived.type_votes).toEqual({ newapi: 2, proxy: 1 });
    expect(derived.free_tier_votes).toEqual({ free: 2, none: 1 });
    expect(derived.user_count).toBe(3);
  });

  it("ignores null icons and handles a single contribution", () => {
    const derived = deriveStat([
      { name: "Solo", icon: null, type: "native", free_tier: "full" },
    ]);
    expect(derived.name).toBe("Solo");
    expect(derived.icon).toBeNull();
    expect(derived.type).toBe("native");
    expect(derived.free_tier).toBe("full");
    expect(derived.user_count).toBe(1);
  });
});
