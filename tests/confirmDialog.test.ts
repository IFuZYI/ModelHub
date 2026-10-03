import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * UX contract: destructive actions must confirm through the app's own themed
 * dialog, never the browser's native `window.confirm`.
 *
 * Native dialogs cannot be styled (they render as a bright OS box on a dark
 * UI), cannot be translated, and block the event loop. A themed ConfirmDialog
 * keeps the destructive-action guard while staying on-brand and testable.
 */

const ROOT = new URL("..", import.meta.url).pathname;
const DIRS = ["app/console", "app/components", "app/providers", "app/p"];

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("destructive-action confirmation", () => {
  const files = DIRS.flatMap((d) => walk(join(ROOT, d)));

  it("uses no native window.confirm / window.alert / window.prompt", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      src.split("\n").forEach((line, i) => {
        // Ignore comments and the word inside strings/identifiers.
        if (/^\s*(\/\/|\*)/.test(line)) return;
        if (/(^|[^.\w])(confirm|alert|prompt)\s*\(/.test(line) && !/ConfirmDialog|\.confirm\b/.test(line)) {
          offenders.push(`${file.replace(ROOT, "")}:${i + 1}  ${line.trim().slice(0, 80)}`);
        }
      });
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("ships a reusable ConfirmDialog component", () => {
    const src = readFileSync(join(ROOT, "app/components/ConfirmDialog.tsx"), "utf8");
    expect(src).toMatch(/export default function ConfirmDialog/);
    // It must be an accessible dialog and offer a cancel path.
    expect(src).toMatch(/role="dialog"|role='dialog'/);
    expect(src).toMatch(/aria-modal/);
    expect(src).toMatch(/取消/);
  });
});
