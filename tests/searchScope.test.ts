// Contract: homepage search is scoped to the homepage owner.
//
// The homepage directory lists ONE owner's sites (/api/providers →
// publicService.homepage(): the primary admin). Its search box used to hit
// /api/search, which scanned providers.listAll() — every user's sites — so a
// homepage search surfaced other users' providers. Search now resolves its
// scope through the SAME owner the homepage lists
// (publicService.homepageOwnerId()) and must never scan all providers.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("homepage search scope", () => {
  it("resolves its scope from the same owner the homepage lists", () => {
    const route = read("app/api/search/route.ts");
    // Pin the CALL, not the phrase: the route's explanatory comment also
    // mentions homepageOwnerId(), so a bare toContain() stays green after the
    // real call is deleted (verified by mutation).
    expect(route).toContain(
      "const ownerId = await publicService.homepageOwnerId();"
    );
  });

  it("searches one owner's providers, never all users'", () => {
    const svc = read("lib/services/searchService.ts");
    expect(svc).toContain("listByUser(");
    expect(svc).not.toContain("listAll(");
  });

  it("has no cross-user author filter or per-hit author payload", () => {
    expect(read("app/api/search/route.ts")).not.toContain('get("author")');
    expect(read("lib/services/searchService.ts")).not.toContain(
      "SearchHitAuthor"
    );
    expect(read("app/page.tsx")).not.toContain("h.author");
  });

  it("keeps homepage copy free of cross-site wording", () => {
    expect(read("app/page.tsx")).not.toContain("跨站");
  });
});
