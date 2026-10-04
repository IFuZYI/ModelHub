// Contract: repeated form fields rendered from a list must get per-item ids.
//
// The create form rendered CATALOG_SLUG_FIELDS through .map() but hardcoded
// id="providers-1101" on every input, with every <label htmlFor="providers-1101">
// pointing at it. Three labels, one id: the labels did not bind to their own
// input (clicking a label focused the wrong field) and assistive tech could not
// associate them. The full-page editor had always done this correctly with
// id={`catalog-${f.id}`}; the list page had not.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const FILES = [
  "app/console/providers/page.tsx",
  "app/console/providers/[id]/page.tsx",
];

describe("catalog slug fields", () => {
  it("derives the input id from the field id in every renderer", () => {
    for (const file of FILES) {
      const src = read(file);
      expect(src, `${file} must use a per-field input id`).toContain(
        "id={`catalog-${f.id}`}"
      );
      expect(src, `${file} must use a matching label target`).toContain(
        "htmlFor={`catalog-${f.id}`}"
      );
    }
  });

  it("has no hardcoded duplicate id on the mapped catalog inputs", () => {
    for (const file of FILES) {
      const src = read(file);
      // The bug shape: a literal id inside the CATALOG_SLUG_FIELDS map.
      const mapBlock = src.slice(src.indexOf("CATALOG_SLUG_FIELDS.map"));
      const literal = mapBlock
        .slice(0, mapBlock.indexOf("</div>"))
        .match(/id="[^"{}]+"/);
      expect(literal, `${file} still hardcodes an id in the map`).toBeNull();
    }
  });
});
