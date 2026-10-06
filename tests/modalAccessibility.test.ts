// Contract: the themed dialogs behave like real modal dialogs.
//
// QA found (all verified with DOM measurements + CDP AX tree):
// - ConfirmDialog: focus sat on 「取消」 but Enter still confirmed the delete
//   (real data loss); Tab escaped to the background after 2 stops; focus was
//   not restored to the trigger on close.
// - The add-provider / create-user modals had NO dialog semantics at all:
//   role/aria-modal null, focus stayed on <body> (18–25 Tab stops through the
//   background before reaching the dialog), Escape did not close.
//
// These pins guard the fixes structurally; the browser probe
// (scripts/ui_interactions.py) exercises them live.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const norm = (f: string) =>
  readFileSync(join(ROOT, f), "utf8").replace(/\s+/g, " ");

const confirm = norm("app/components/ConfirmDialog.tsx");
const shell = norm("app/components/ModalShell.tsx");

describe("ConfirmDialog keyboard contract", () => {
  it("Enter activates the FOCUSED control — 取消 must never confirm", () => {
    // The global keydown listener preempts native button activation, so it
    // must reproduce it: focus on 取消 → cancel; otherwise → confirm.
    expect(confirm).toContain(
      "if (document.activeElement === cancelRef.current) onCancel();"
    );
    // …and the confirm branch must be gated by the same-tick guard.
    expect(confirm).toContain("if (firedRef.current || busy) return;");
  });

  it("Escape cancels — and a nested control that consumed it wins", () => {
    // A nested widget (Select's dropdown) runs first and calls
    // preventDefault(); the window listener must not double-handle.
    expect(confirm).toContain("if (e.defaultPrevented) return;");
    expect(confirm).toContain('if (e.key === "Escape")');
  });

  it("traps Tab inside the dialog", () => {
    expect(confirm).toContain('if (e.key === "Tab")');
    expect(confirm).toContain("focusables");
  });

  it("Escape is inert mid-flight (busy) — same contract as the disabled buttons", () => {
    expect(confirm).toContain("if (busy) return;");
  });

  it("captures the trigger on open and restores it on close", () => {
    expect(confirm).toContain("triggerRef.current = document.activeElement");
    expect(confirm).toContain("triggerRef.current?.focus?.();");
  });

  it("re-arms the confirm guard after a failed attempt", () => {
    // The dialog stays open when the request fails; without the re-arm the
    // confirm button would stay inert for the rest of the dialog's life.
    expect(confirm).toContain("if (!busy) firedRef.current = false;");
  });
});

describe("ModalShell (add-provider / create-user dialogs)", () => {
  it("declares dialog semantics with an accessible name", () => {
    expect(shell).toContain('role="dialog"');
    expect(shell).toContain("aria-modal");
    expect(shell).toContain("aria-label={label}");
  });

  it("moves focus in, traps Tab, closes on Escape, restores focus", () => {
    expect(shell).toContain("if (e.defaultPrevented) return;");
    expect(shell).toContain("first?.focus();");
    expect(shell).toContain('if (e.key === "Escape")');
    expect(shell).toContain('if (e.key === "Tab")');
    expect(shell).toContain("triggerRef.current?.focus?.();");
  });

  it("keeps the keydown listener bound once (ref-held onClose)", () => {
    // Callers pass a fresh closure each render; without the ref the window
    // listener would be removed and re-added on every render.
    expect(shell).toContain("onCloseRef.current = onClose;");
    expect(shell).toContain("onCloseRef.current();");
  });

  it("pulls focus back when it sits outside the dialog", () => {
    expect(shell).toContain("if (!root.contains(document.activeElement))");
  });

  it("is used by both business modals", () => {
    expect(norm("app/console/providers/page.tsx")).toContain("<ModalShell");
    expect(norm("app/console/users/page.tsx")).toContain("<ModalShell");
  });
});
