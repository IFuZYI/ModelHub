// Contract: the profile page offers a direct "go to my share page" button.
//
// The panel listed the /p/{slug} URL as text; the only way to actually visit
// it was to select the link text or hand-type the path. It now carries an
// explicit 前往站点（分享页） button next to 重新生成.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const profile = readFileSync(
  join(ROOT, "app/console/profile/page.tsx"),
  "utf8"
);

describe("profile share-page panel", () => {
  it("offers a direct link to the share page", () => {
    expect(profile).toContain("前往站点（分享页）");
    // The button must point at the share page itself and open a new tab.
    expect(profile).toMatch(/href=\{`\/p\/\$\{slug\}`\}/);
    expect(profile).toContain('target="_blank"');
  });

  it("keeps the existing actions", () => {
    expect(profile).toContain("你的公开页：");
    expect(profile).toContain("重新生成");
    expect(profile).toContain("生成个人页链接");
  });
});
