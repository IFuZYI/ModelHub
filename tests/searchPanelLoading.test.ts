// Contract: the search panel must not flash a false "0 命中" state.
//
// `visibleHits` is already filtered (`hits ?? []`), so it is never null and
// the old `searching && hits === null` spinner branch was dead code: for the
// debounce(250ms) + fetch window the panel showed 「搜索 … — 0 个站点命中」
// plus the empty-state copy 「没有站点包含 …」 before the response arrived —
// indistinguishable from a genuine miss. Verified in a browser with a
// delayed /api/search response before the fix (flash present) and after
// (spinner shown instead).
//
// The fix passes the raw nullness as `loaded` and gates the panel on it.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const page = readFileSync(join(ROOT, "app/page.tsx"), "utf8");
const norm = page.replace(/\s+/g, " ");

describe("search panel loading state", () => {
  it("passes the raw loaded signal (hits !== null) into the panel", () => {
    expect(norm).toContain("loaded={hits !== null}");
  });

  it("shows the spinner until the first response commits", () => {
    expect(norm).toContain(
      'if (!loaded) return <div className="spin">搜索中…</div>;'
    );
  });

  it("has no dead null-branch on the filtered hits", () => {
    // The old shape: `searching && hits === null` on a never-null prop.
    expect(norm).not.toContain("hits: SearchHit[] | null");
  });
});
