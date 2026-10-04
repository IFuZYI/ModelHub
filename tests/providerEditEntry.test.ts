// Contract: one edit experience.
//
// A site could be opened for editing from two places — the overview's site
// cards and the "我的站点" list — and they behaved differently: the overview
// navigated to the full-page editor (/console/providers/{id}, titled 编辑站点)
// while the list opened a modal titled 编辑提供商. Same object, two editors.
//
// Both entries must navigate to the full-page editor, and that editor must
// carry the fields the modal could edit (catalog slugs for official
// providers) — otherwise unifying the entry point silently drops capability.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const overview = read("app/console/page.tsx");
const list = read("app/console/providers/page.tsx");
const editor = read("app/console/providers/[id]/page.tsx");

/** The href both entry points must share. */
const EDITOR_HREF = "href={`/console/providers/${p.id}`}";

describe("provider edit entry", () => {
  it("opens the full-page editor from both the overview and the list", () => {
    expect(overview).toContain(EDITOR_HREF);
    expect(list).toContain(EDITOR_HREF);
  });

  it("has no modal edit path left in the list", () => {
    // The modal remains for CREATING a provider; editing is not its job.
    expect(list).not.toContain("openEdit");
    expect(list).not.toContain("编辑提供商");
    expect(list).toContain("添加提供商");
  });

  it("the full-page editor edits catalog slugs (parity with the old modal)", () => {
    // These fields were the modal's alone; the unified editor must carry them
    // or the unification would silently drop the capability.
    expect(editor).toContain("CATALOG_SLUG_FIELDS");
    expect(editor).toMatch(/body\.catalog_slugs\s*=/);
  });
});
