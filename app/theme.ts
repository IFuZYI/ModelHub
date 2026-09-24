"use client";

import { useEffect } from "react";

/** Applies persisted theme on mount and exposes a toggle. */
export function useTheme() {
  useEffect(() => {
    const saved = localStorage.getItem("modelhub-theme");
    // default is dark (set on <html> in layout); only override if a choice was saved
    if (saved) document.documentElement.dataset.theme = saved;
  }, []);
}

export function toggleTheme() {
  const el = document.documentElement;
  const next = el.dataset.theme === "light" ? "dark" : "light";
  el.dataset.theme = next;
  localStorage.setItem("modelhub-theme", next);
}
