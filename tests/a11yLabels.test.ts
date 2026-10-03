import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Accessibility contract for form labels.
 *
 * Every <label> that describes a form control must be ASSOCIATED with it —
 * either by wrapping the control, or via htmlFor + a matching id. A bare
 * <label> looks right but leaves screen readers with an unlabelled field and
 * makes clicking the label fail to focus the input.
 *
 * This is checked structurally over the source (the alternative, a browser
 * probe, is covered by scripts/ui_checks.py); keeping it here means the rule
 * is enforced on every `npm test` without a running server.
 */

const ROOT = new URL("..", import.meta.url).pathname;
const DIRS = ["app/console", "app/components", "app/login", "app/providers", "app/p"];

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** Extract every `<label ...>` opening tag (not self-closing) with its attrs. */
function labelTags(src: string): { attrs: string; index: number }[] {
  const out: { attrs: string; index: number }[] = [];
  const re = /<label\b([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    out.push({ attrs: m[1], index: m.index });
  }
  return out;
}

/**
 * A label is acceptable when it has htmlFor (association by id) or when the
 * JSX right after it contains a control before the closing </label> (wrapping).
 * Anything else is a bare label.
 */
function isAssociated(src: string, index: number): boolean {
  const tagEnd = src.indexOf(">", index);
  const attrs = src.slice(index, tagEnd);
  if (/\bhtmlFor\s*=/.test(attrs)) return true;
  // Wrapping form: the control appears before the matching </label>.
  const close = src.indexOf("</label>", tagEnd);
  if (close === -1) return false;
  const inner = src.slice(tagEnd, close);
  return /<(input|select|textarea|Select)\b/.test(inner);
}

describe("form label association", () => {
  const files = DIRS.flatMap((d) => walk(join(ROOT, d)));

  it("finds the component files", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("has no unassociated <label> describing a control", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const { attrs, index } of labelTags(src)) {
        if (isAssociated(src, index)) continue;
        const line = src.slice(0, index).split("\n").length;
        const text = src
          .slice(index)
          .match(/<label\b[^>]*>([^<]{0,40})/)?.[1]
          ?.trim();
        offenders.push(
          `${file.replace(ROOT, "")}:${line}  <label${attrs.trim() ? " " + attrs.trim() : ""}>  ${text ?? ""}`
        );
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
