"use client";

import { useEffect } from "react";

/** Default document title set by the root layout. */
export const DEFAULT_TITLE = "ModelHub · 模型导航";

/**
 * Set a page-specific document title from a client component.
 *
 * Every page here is a client component, so it cannot export the `metadata`
 * object (Next.js only reads metadata from server components). Without this,
 * all pages shared the root layout's title — browser tabs and history entries
 * were indistinguishable (WCAG 2.4.2 Page Titled).
 *
 * React owns the <title> element (it renders it from the root layout's
 * metadata) and rewrites it on hydration/route commits. Verified on a hard
 * load: shortly after this effect ran, the title text node was reset to the
 * layout default, so a one-shot write is not enough — the hook re-asserts
 * the desired title whenever the element changes underneath it.
 *
 * Pass null/undefined while data is loading to keep the default title.
 */
export function usePageTitle(title: string | null | undefined): void {
  useEffect(() => {
    const desired = title ? `${title} · ModelHub` : DEFAULT_TITLE;
    document.title = desired;
    // Observe the whole <head>, not just the current <title> node: React may
    // replace the element, and an observer bound to a detached node would go
    // blind. The callback is a cheap string compare when nothing changed.
    const observer = new MutationObserver(() => {
      if (document.title !== desired) document.title = desired;
    });
    observer.observe(document.head, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    return () => {
      observer.disconnect();
      document.title = DEFAULT_TITLE;
    };
  }, [title]);
}
