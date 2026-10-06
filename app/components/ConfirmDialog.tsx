"use client";

import { useEffect, useRef } from "react";

/**
 * Themed confirmation dialog for destructive actions.
 *
 * Replaces window.confirm(), which renders as a bright OS box on the dark
 * theme, cannot be translated, and blocks the event loop. This keeps the
 * guard while staying on-brand and testable.
 *
 * Keyboard: Escape cancels; Enter follows FOCUS — confirm only when the
 * confirm button (or anything other than 取消) holds focus. Focus starts on
 * 取消 and is trapped inside the dialog (aria-modal promises the background
 * is inert), and returns to the trigger on close.
 */
export default function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "确认删除",
  cancelLabel = "取消",
  danger = true,
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  /** Failure message from a previous attempt; shown INSIDE the dialog so it
   *  is not hidden behind the overlay. */
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // The element focused before the dialog opened, so focus can return.
  const triggerRef = useRef<HTMLElement | null>(null);
  // Synchronous guard: a same-tick double click runs twice before `busy`
  // re-renders, so the state prop alone cannot block the second confirm.
  const firedRef = useRef(false);

  // Focus the safe action on open; restore the trigger on close.
  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement as HTMLElement | null;
      cancelRef.current?.focus();
      firedRef.current = false;
    } else {
      triggerRef.current?.focus?.();
      triggerRef.current = null;
    }
  }, [open]);

  // Re-arm the same-tick guard once nothing is in flight: a failed confirm
  // (request errored, dialog stays open) must not leave the button inert.
  useEffect(() => {
    if (!busy) firedRef.current = false;
  }, [busy]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // Never double-handle a key an inner control already consumed.
      if (e.defaultPrevented) return;
      if (e.key === "Escape") {
        // Mid-flight (busy): the dialog must not dismiss — same contract as
        // the disabled cancel button and the busy-guarded backdrop.
        if (busy) return;
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === "Enter" && !busy) {
        e.preventDefault();
        // Enter activates the FOCUSED control. The global listener preempts
        // the button's native activation, so it must reproduce the intent:
        // 取消 (which holds focus on open) must never confirm.
        if (document.activeElement === cancelRef.current) onCancel();
        else if (!firedRef.current) {
          firedRef.current = true;
          onConfirm();
        }
        return;
      }
      if (e.key === "Tab") {
        // Trap focus inside the dialog — aria-modal="true" declares the
        // background inert, so Tab must not escape into it.
        const root = dialogRef.current;
        if (!root) return;
        const focusables = [
          ...root.querySelectorAll<HTMLElement>("button:not([disabled])"),
        ];
        // Mid-flight both buttons are disabled: block Tab outright rather
        // than let focus wander into the background.
        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        // Pull focus back in when it sits OUTSIDE the dialog (e.g. on <body>
        // after a click on non-focusable dialog text).
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
  }, [open, busy, onCancel, onConfirm]);

  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        // Clicking the backdrop cancels; clicks inside the box do not.
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="modal confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={body ? "confirm-body" : undefined}
      >
        <h2 id="confirm-title">{title}</h2>
        {body && (
          <p id="confirm-body" className="confirm-body">
            {body}
          </p>
        )}
        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="btn secondary"
            ref={cancelRef}
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn${danger ? " danger" : ""}`}
            onClick={() => {
              if (firedRef.current || busy) return;
              firedRef.current = true;
              onConfirm();
            }}
            disabled={busy}
          >
            {busy ? "处理中…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
