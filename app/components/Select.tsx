"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
  type KeyboardEvent,
} from "react";

export interface SelectOption {
  value: string;
  label: string;
}

/** Nearest ancestor that scrolls vertically — the box a popup gets clipped by. */
function nearestScrollParent(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return node;
    node = node.parentElement;
  }
  return null;
}

interface Props {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** Accessible label; also used as fallback trigger text when nothing matches. */
  ariaLabel?: string;
  className?: string;
  id?: string;
}

/**
 * Themed, accessible dropdown that replaces the native <select> so the popup
 * matches the monochrome theme across browsers (native option lists can't be
 * styled). Supports mouse + full keyboard control and closes on outside click.
 */
export default function Select({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  id,
}: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0); // highlighted index while open
  /** Flip the menu above the trigger when it would overflow the viewport or
      the nearest scrollport (e.g. the modal body). */
  const [dropUp, setDropUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const autoId = useId();
  const listboxId = id ? `${id}-listbox` : `sel-${autoId}`;

  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  );
  const selected = options[selectedIndex];

  const close = useCallback(() => setOpen(false), []);

  // Close on outside click / Escape-less blur.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) close();
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open, close]);

  // When opening, highlight the current selection and scroll it into view.
  useEffect(() => {
    if (open) {
      setActive(selectedIndex);
      requestAnimationFrame(() => {
        const el = listRef.current?.children[selectedIndex] as
          | HTMLElement
          | undefined;
        el?.scrollIntoView({ block: "nearest" });
      });
    }
  }, [open, selectedIndex]);

  // Decide the drop direction before paint: measure the menu once mounted and
  // flip it up when it would be clipped below (by the viewport OR a scrollport).
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const root = rootRef.current;
      const menu = listRef.current;
      if (!root || !menu) return;
      const rootRect = root.getBoundingClientRect();
      const menuHeight = menu.offsetHeight;
      const boundary = nearestScrollParent(root);
      const limitBottom = boundary
        ? Math.min(innerHeight, boundary.getBoundingClientRect().bottom)
        : innerHeight;
      const limitTop = boundary
        ? Math.max(0, boundary.getBoundingClientRect().top)
        : 0;
      const fitsBelow = rootRect.bottom + 6 + menuHeight <= limitBottom;
      const fitsAbove = rootRect.top - 6 - menuHeight >= limitTop;
      setDropUp(!fitsBelow && fitsAbove);
    };
    measure();
    const boundary = nearestScrollParent(rootRef.current!);
    const onScrollOrResize = () => measure();
    boundary?.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      boundary?.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  // Close on scroll of the enclosing scrollport — the menu is absolutely
  // positioned, so scrolling away would leave it visually detached.
  useEffect(() => {
    if (!open) return;
    const boundary = nearestScrollParent(rootRef.current!);
    if (!boundary) return;
    boundary.addEventListener("scroll", close, { passive: true });
    return () => boundary.removeEventListener("scroll", close);
  }, [open, close]);

  function commit(index: number) {
    const opt = options[index];
    if (opt) onChange(opt.value);
    close();
  }

  function moveActive(next: number) {
    const clamped = Math.max(0, Math.min(options.length - 1, next));
    setActive(clamped);
    const el = listRef.current?.children[clamped] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!open) setOpen(true);
        else moveActive(active + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (!open) setOpen(true);
        else moveActive(active - 1);
        break;
      case "Home":
        if (open) {
          e.preventDefault();
          moveActive(0);
        }
        break;
      case "End":
        if (open) {
          e.preventDefault();
          moveActive(options.length - 1);
        }
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (open) commit(active);
        else setOpen(true);
        break;
      case "Escape":
        if (open) {
          e.preventDefault();
          close();
        }
        break;
      case "Tab":
        close();
        break;
    }
  }

  return (
    <div
      ref={rootRef}
      className={`sel${open ? " open" : ""}${dropUp ? " drop-up" : ""}${
        className ? ` ${className}` : ""
      }`}
    >
      <button
        type="button"
        id={id}
        className="sel-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKeyDown}
      >
        <span className="sel-value">{selected?.label ?? ariaLabel ?? ""}</span>
        <span className="sel-caret" aria-hidden="true" />
      </button>
      {open && (
        <ul
          ref={listRef}
          className="sel-menu"
          role="listbox"
          id={listboxId}
          aria-activedescendant={`${listboxId}-opt-${active}`}
          tabIndex={-1}
        >
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${listboxId}-opt-${i}`}
              role="option"
              aria-selected={o.value === value}
              className={`sel-option${i === active ? " active" : ""}${
                o.value === value ? " selected" : ""
              }`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                // mousedown (not click) so it fires before the outside-click handler
                e.preventDefault();
                commit(i);
              }}
            >
              <span className="sel-option-label">{o.label}</span>
              {o.value === value && (
                <span className="sel-check" aria-hidden="true">
                  ✓
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
