// Contract: error and loading states that QA found broken must stay fixed.
//
// Each block corresponds to a verified finding; the pin guards the wiring so
// a refactor cannot silently reintroduce the dead-end / crash / misreport.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const norm = (f: string) =>
  readFileSync(join(ROOT, f), "utf8").replace(/\s+/g, " ");

describe("detail page resilience", () => {
  const page = norm("app/providers/[id]/page.tsx");

  it("surfaces non-404 failures instead of crashing the render", () => {
    // A 500 used to fall through to `setP(await res.json())` and the render
    // crashed on missing `rating` (uncaught TypeError, blank page).
    expect(page).toContain('if (!res.ok) throw new Error("无法加载站点信息");');
    expect(page).toContain("if (loadError)");
  });

  it("keeps the vendor chip row visible while a vendor filter is active", () => {
    // The empty-intersection dead-end: chips row disappeared (vendors.length
    // <= 1) while the active filter stayed applied — no way to reset.
    expect(page).toContain('(vendors.length > 1 || vendor !== "all")');
  });

  it("renders an explanatory empty state for an empty intersection", () => {
    expect(page).toContain(
      "当前厂商筛选下没有匹配的模型，可切回「全部」查看。"
    );
  });

  it("counts only actually-rendered models in the results bar", () => {
    // The bar said 「匹配 N」 with N ignoring the vendor chip.
    expect(page).toContain(
      "const visibleCount = groups.reduce((n, g) => n + g.models.length, 0);"
    );
    expect(page).toContain("filteredCount: visibleCount");
  });

  it("keeps the active vendor chip when the search leaves it empty", () => {
    expect(page).toContain("vendorList.push({ key: vendor, count: 0 });");
  });
});

describe("personal page resilience", () => {
  const page = norm("app/p/[slug]/page.tsx");

  it("surfaces non-404 failures instead of crashing on missing owner", () => {
    expect(page).toContain('if (!res.ok) throw new Error("无法加载个人主页");');
    expect(page).toContain("if (loadError)");
  });

  it("reflects the real session in the header", () => {
    // The probe must never reject: a network failure keeps the logged-out
    // shape instead of an unhandled rejection. (norm() collapses whitespace.)
    expect(page).toContain(
      "fetchAuthStatus() .then((auth) => setAuthed(auth.authenticated)) .catch(() => setAuthed(false));"
    );
    expect(page).toContain("onLogout=");
  });

  it("has no nested anchors (stretched link instead)", () => {
    expect(page).toContain('className="card-stretch"');
    // The card itself must no longer be a Link wrapping the 前往 anchor.
    expect(page).not.toContain(
      '<Link key={p.id} href={`/providers/${p.id}`} className="site-card">'
    );
  });
});

describe("homepage search resilience", () => {
  const page = norm("app/page.tsx");

  it("a 500 is not reported as zero results", () => {
    expect(page).toContain(
      'if (!res.ok) throw new Error("搜索失败，请稍后重试");'
    );
    expect(page).toContain("搜索失败，请稍后重试。");
  });

  it("syncs the query into the URL so Back restores the search", () => {
    expect(page).toContain('url.searchParams.set("q", query);');
    expect(page).toContain('window.history.replaceState(null, "", next);');
  });

  it("applies the sort control to search hits", () => {
    expect(page).toContain("[hits, catFilter, freeFilter, sort]");
  });
});

describe("page titles (WCAG 2.4.2)", () => {
  it("every page sets a specific document title", () => {
    expect(norm("app/lib/usePageTitle.ts")).toContain("document.title =");
    expect(norm("app/components/ConsoleShell.tsx")).toContain(
      "usePageTitle(title);"
    );
    expect(norm("app/providers/[id]/page.tsx")).toContain(
      "usePageTitle(p?.name);"
    );
    expect(norm("app/p/[slug]/page.tsx")).toContain("usePageTitle(");
    expect(norm("app/login/page.tsx")).toContain(
      'usePageTitle(mode === "login" ? "登录" : "注册");'
    );
  });
});

describe("status messages are announced (aria-live)", () => {
  it("error boxes alert, note boxes and saved confirmations are status", () => {
    // Pin the SPECIFIC message elements, not just any role occurrence.
    expect(norm("app/login/page.tsx")).toContain(
      '<div className="auth-error" role="alert">'
    );
    expect(norm("app/console/settings/page.tsx")).toContain(
      '{err && <div className="error-box" role="alert">'
    );
    expect(norm("app/console/providers/page.tsx")).toContain(
      '<div className="error-box" role="alert"'
    );
    expect(norm("app/providers/[id]/page.tsx")).toContain(
      '<div className="error-box" role="alert">'
    );
    // Success confirmations announce via role=status, not alert.
    expect(norm("app/console/profile/page.tsx")).toContain(
      '{saved && <div className="card-domain" role="status">'
    );
  });
});
