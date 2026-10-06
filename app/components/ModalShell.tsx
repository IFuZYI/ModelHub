"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Themed modal shell with real dialog semantics.
 *
 * The add-provider and create-user modals previously rendered a bare
 * `.modal-overlay` div: no role/aria-modal, no Escape handling, and focus
 * stayed on <body> so keyboard users had to Tab through the whole page
 * (18–25 stops) to reach the dialog, then could Tab straight back out.
 *
 * This shell provides: role=dialog + aria-modal + an accessible name,
 * focus moved in on open and restored on close, Tab trapped inside, and
 * Escape to dismiss. ConfirmDialog keeps its own implementation (it has
 * confirm/cancel specifics), but follows the same contract.
 */
export default function ModalShell({
  label,
  onClose,
  children,
}: {
  /** Accessible name for the dialog (matches its visible title). */
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  // Latest onClose without re-binding the window listener on every render
  // (callers pass a fresh closure each render).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement | null;
    // Move focus to the first control inside the dialog.
    const first = dialogRef.current?.querySelector<HTMLElement>(
      "button, input, select, textarea, a[href]"
    );
    first?.focus();
    return () => {
      triggerRef.current?.focus?.();
      triggerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A nested control (e.g. the Select dropdown) may have already consumed
      // the key — its React handler runs before this window listener and
      // calls preventDefault(). Acting again would close BOTH the dropdown
      // and the modal, silently discarding the half-typed form.
      if (e.defaultPrevented) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key === "Tab") {
        const root = dialogRef.current;
        if (!root) return;
        const focusables = [
          ...root.querySelectorAll<HTMLElement>(
            "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]"
          ),
        ];
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        // Pull focus back in when it sits OUTSIDE the dialog (e.g. on <body>
        // after a click on non-focusable dialog text) — aria-modal="true"
        // promises the background is inert, so Tab must never wander there.
        if (!root.contains(document.activeElement)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
          return;
        }
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
