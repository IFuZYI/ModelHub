// Contract: homepage free-tier filter (FREE 等级筛选).
//
// The homepage has two filter dimensions — category (官方/其他) and free-tier
// grade (ALL FREE / FREE / NO). Both must apply to BOTH the directory list and
// the search results: f6da2b7 fixed the category row after it was hidden and
// inert in search mode, and the free row must not repeat that bug.
//
// Pins are whitespace-normalized so Prettier line wrapping cannot break them,
// and each wiring is pinned separately so deleting one cannot hide behind the
// other's string.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const page = readFileSync(join(ROOT, "app/page.tsx"), "utf8");
/** Whitespace-collapsed source, so pins survive line wrapping. */
const norm = page.replace(/\s+/g, " ");

describe("homepage free-tier filter wiring", () => {
  it("renders a chip for every grade selection", () => {
    expect(page).toContain("FREE_TIER_FILTERS.map");
    expect(page).toContain("freeTierLabel(t)");
  });

  it("applies the filter to the directory list", () => {
    expect(norm).toContain("list = filterHitsByFreeTier(list, freeFilter);");
  });

  it("applies the filter to search hits, composed with the category filter", () => {
    expect(norm).toContain(
      "filterHitsByFreeTier( filterHitsByCategory(hits ?? [], catFilter), freeFilter )"
    );
  });

  it("recomputes both lists when the free filter changes", () => {
    expect(norm).toContain("[providers, query, catFilter, freeFilter, sort]");
    // Search hits also recompute on sort now: the sort control applies to
    // search results too (it used to be visible but inert in search mode).
    expect(norm).toContain("[hits, catFilter, freeFilter, sort]");
  });

  it("shares one label source between the card badge and the chips", () => {
    // Both must call freeTierLabel — a hardcoded label in either place would
    // let the badge and the filter vocabulary drift apart silently.
    const badges = readFileSync(
      join(ROOT, "app/components/badges.tsx"),
      "utf8"
    );
    expect(badges).toContain("freeTierLabel(tier)");
    expect(badges).not.toMatch(/"ALL FREE"|"FREE"/);
  });
});
