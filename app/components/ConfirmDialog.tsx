"use client";

import { useEffect, useRef } from "react";

/**
 * Themed confirmation dialog for destructive actions.
 *
 * Replaces window.confirm(), which renders as a bright OS box on the dark
 * theme, cannot be translated, and blocks the event loop. This keeps the
 * guard while staying on-brand and testable.
 *
 * Keyboard: Escape cancels, Enter confirms, and focus starts on the cancel
 * button so a stray Enter does not destroy data.
 */
export default function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "确认删除",
  cancelLabel = "取消",
  danger = true,
  busy = false,
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
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus the safe action on open; restore nothing (the caller owns focus).
  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter" && !busy) {
        e.preventDefault();
        onConfirm();
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
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "处理中…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
