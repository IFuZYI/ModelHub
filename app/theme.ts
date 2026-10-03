"use client";

/**
 * Theme handling.
 *
 * The persisted choice is applied by an inline script in the root layout
 * BEFORE first paint (see app/layout.tsx), so there is no flash of the wrong
 * palette and no dark-palette text on a light background. This module only
 * owns the toggle; re-applying the stored value on mount would fight the
 * inline script and cause a visible swap, so `useTheme` is now a no-op kept
 * for call-site compatibility.
 */

export function useTheme() {
  // Intentionally empty: see the module comment above.
}

export function toggleTheme() {
  const el = document.documentElement;
  const next = el.dataset.theme === "light" ? "dark" : "light";
  el.dataset.theme = next;
  try {
    localStorage.setItem("modelhub-theme", next);
  } catch {
    // Private mode / storage disabled: the toggle still works for this page.
  }
}
