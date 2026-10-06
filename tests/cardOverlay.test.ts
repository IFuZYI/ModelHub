// Contract: the personal-page card is a whole-card click target.
//
// The card is a plain <div> holding two sibling links: the title link
// (.card-stretch) whose ::after paints over the card, and the external
// 「前往」 link (.card-go). The overlay sizes against the nearest POSITIONED
// ancestor — when .card-top/.card-bottom carried `position: relative`, the
// overlay resolved to the ~44px title row only and most of the card stopped
// being clickable (a regression: the card used to be one big <Link>).
// These pins lock the containing-block contract so a future rule cannot
// silently re-scope the overlay; the live behavior is exercised by the
// browser probes.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const css = readFileSync(join(ROOT, "app/globals.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  ""
);

/** Extract the body of a top-level rule by selector (first match). */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`rule not found: ${selector}`);
  return m[1];
}

describe("card stretched-link overlay", () => {
  it("keeps .card-top and .card-bottom NON-positioned (overlay spans the card)", () => {
    // position: relative here re-scopes .card-stretch::after to the row.
    expect(ruleBody(".card-top")).not.toMatch(/position\s*:/);
    expect(ruleBody(".card-bottom")).not.toMatch(/position\s*:/);
  });

  it("anchors the overlay to the card itself", () => {
    expect(ruleBody(".site-card")).toMatch(/position\s*:\s*relative/);
    const overlay = ruleBody(".card-stretch::after");
    expect(overlay).toMatch(/position\s*:\s*absolute/);
    expect(overlay).toMatch(/inset\s*:\s*0/);
  });

  it("gives the card its own stacking context for the negative-z pseudos", () => {
    expect(ruleBody(".site-card")).toMatch(/isolation\s*:\s*isolate/);
  });

  it("keeps the sheen/wash BELOW the card content (negative z-index)", () => {
    expect(ruleBody(".site-card::before")).toMatch(/z-index\s*:\s*-1/);
    expect(ruleBody(".site-card::after")).toMatch(/z-index\s*:\s*-1/);
  });

  it("keeps the 前往 link above the overlay", () => {
    const go = ruleBody(".card-go");
    expect(go).toMatch(/position\s*:\s*relative/);
    expect(go).toMatch(/z-index\s*:\s*1/);
  });
});
