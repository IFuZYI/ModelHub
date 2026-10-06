// Contract: widgets must never overflow their container.
//
// The themed Select is display:inline-block, so it shrink-wraps to the
// widest option label. In the 数据迁移 panel (moved inside the console
// shell's narrower column) a long option label ("合并（按 ID 更新，保留现有
// 数据）") pushed the widget 7px past its panel at 320px. max-width:100%
// contains it; the label itself already ellipsizes via .sel-value.
// scripts/ui_probe.py exercises the live layout across 60 page/width combos.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const css = readFileSync(join(ROOT, "app/globals.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  ""
);

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`rule not found: ${selector}`);
  return m[1];
}

describe("select containment", () => {
  it("never grows past the field it sits in", () => {
    expect(ruleBody(".sel")).toMatch(/max-width\s*:\s*100%/);
  });

  it("ellipsizes a too-long selected label instead of overflowing", () => {
    const value = ruleBody(".sel-value");
    expect(value).toMatch(/overflow\s*:\s*hidden/);
    expect(value).toMatch(/text-overflow\s*:\s*ellipsis/);
  });
});
