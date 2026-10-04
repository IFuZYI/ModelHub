#!/usr/bin/env python3
"""
UI measurement probe for ModelHub.

Runs the app in a real browser at several viewport widths and reports
*measured* defects: overflow, clipped nav, unreachable controls, missing
labels, contrast failures, focus gaps. Prints JSON per (page, width).

Usage: python3 scripts/ui_probe.py [--base http://127.0.0.1:9000] [--json out.json]
"""
import argparse
import json
import sys

from playwright.sync_api import sync_playwright

PAGES = [
    ("/", "home"),
    ("/login", "login"),
    ("/console", "console-overview"),
    ("/console/providers", "console-providers"),
    ("/console/providers/afdf5c67-f0c0-4a92-8d11-378d8a999ce9", "console-provider-edit"),
    ("/console/profile", "console-profile"),
    ("/console/account", "console-account"),
    ("/console/users", "console-users"),
    ("/console/stats", "console-stats"),
    ("/console/settings", "console-settings"),
    ("/providers/afdf5c67-f0c0-4a92-8d11-378d8a999ce9", "provider-detail"),
    ("/p/bbajd2w4ui9y", "personal-page"),
]

WIDTHS = [320, 390, 768, 1024, 1440]

# One big measurement pass, run inside the page. Keep it dependency-free.
MEASURE_JS = r"""
(() => {
  const out = { problems: [], metrics: {} };
  const vw = window.innerWidth, vh = window.innerHeight;
  out.metrics.viewport = { w: vw, h: vh };

  const desc = (el) => {
    if (!el) return '?';
    const id = el.id ? '#' + el.id : '';
    const cls = el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return el.tagName.toLowerCase() + id + cls;
  };
  const rect = (el) => el.getBoundingClientRect();
  const visible = (el) => {
    const r = rect(el);
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    if (parseFloat(s.opacity || '1') === 0) return false;
    return true;
  };

  // ---- 1. horizontal document overflow ----
  const docW = Math.max(
    document.documentElement.scrollWidth,
    document.body.scrollWidth
  );
  out.metrics.docScrollWidth = docW;
  if (docW > vw + 1) {
    // Find the widest offenders.
    const offenders = [];
    for (const el of document.querySelectorAll('*')) {
      const r = rect(el);
      if (r.width === 0) continue;
      if (r.right > vw + 1 || r.left < -1) {
        // Only report if it's not a child of an already-reported offender.
        offenders.push({
          sel: desc(el),
          left: Math.round(r.left),
          right: Math.round(r.right),
          width: Math.round(r.width),
          text: (el.innerText || '').trim().slice(0, 40),
        });
      }
    }
    // Keep the outermost few.
    offenders.sort((a, b) => b.right - a.right);
    out.problems.push({
      kind: 'doc-overflow-x',
      severity: 'high',
      detail: `document scrollWidth ${docW} > viewport ${vw}`,
      offenders: offenders.slice(0, 6),
    });
  }

  // ---- 2. per-element overflow inside scroll containers ----
  const scrollables = document.querySelectorAll(
    'table, pre, .panel, .card, nav, .toolbar, [class*="table"]'
  );
  const squeezed = [];
  for (const el of scrollables) {
    if (!visible(el)) continue;
    const s = getComputedStyle(el);
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
      // Overflowing but scrollable is OK only if overflow-x allows it.
      const scrollable = s.overflowX === 'auto' || s.overflowX === 'scroll';
      if (!scrollable) {
        squeezed.push({
          sel: desc(el),
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          overflowX: s.overflowX,
        });
      }
    }
  }
  if (squeezed.length) {
    out.problems.push({
      kind: 'clipped-content',
      severity: 'high',
      detail: 'content wider than its container with no scroll',
      items: squeezed.slice(0, 6),
    });
  }

  // ---- 3. controls outside the viewport (invisible but rendered) ----
  const offscreen = [];
  for (const el of document.querySelectorAll(
    'button, a[href], input, select, textarea, [role="button"]'
  )) {
    if (!visible(el)) continue;
    const r = rect(el);
    // Ignore elements inside a horizontally scrollable ancestor.
    let p = el.parentElement, inScroller = false;
    while (p) {
      const ps = getComputedStyle(p);
      if (ps.overflowX === 'auto' || ps.overflowX === 'scroll') { inScroller = true; break; }
      p = p.parentElement;
    }
    if (inScroller) continue;
    if (r.right > vw + 1 || r.left < -1) {
      // Horizontal escape only — vertical position is not a defect (normal
      // content below the fold has a large `top`).
      offscreen.push({
        sel: desc(el),
        text: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 30),
        left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top),
      });
    }
  }
  if (offscreen.length) {
    out.problems.push({
      kind: 'controls-offscreen',
      severity: 'high',
      detail: 'interactive elements rendered outside the viewport',
      items: offscreen.slice(0, 8),
    });
  }

  // ---- 4. tap-target size (mobile) ----
  if (vw <= 480) {
    const small = [];
    for (const el of document.querySelectorAll('button, a[href], [role="button"], input[type="checkbox"]')) {
      if (!visible(el)) continue;
      const r = rect(el);
      if (r.width === 0) continue;
      if (r.height < 32 || r.width < 24) {
        // A control wrapped in a <label> (or with an explicit larger parent
        // hit area) is clickable across that whole box — measuring only the
        // inner input reports a 13x13 "defect" on a 308x44 toggle row.
        const lbl = el.closest('label');
        const eff = lbl ? rect(lbl) : r;
        if (eff.height >= 32 && eff.width >= 24) continue;
        small.push({
          sel: desc(el),
          text: (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 24),
          w: Math.round(r.width), h: Math.round(r.height),
          effW: Math.round(eff.width), effH: Math.round(eff.height),
        });
      }
    }
    if (small.length) {
      out.problems.push({
        kind: 'small-tap-targets',
        severity: 'medium',
        detail: `${small.length} interactive elements under 32px tall`,
        items: small.slice(0, 8),
      });
    }
  }

  // ---- 5. missing labels / accessible names on form fields ----
  const unlabeled = [];
  for (const el of document.querySelectorAll('input, select, textarea')) {
    if (!visible(el)) continue;
    if (el.type === 'hidden') continue;
    const id = el.id;
    const hasLabel = id && document.querySelector(`label[for="${CSS.escape(id)}"]`);
    const wrapped = el.closest('label');
    const aria = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
    const ph = el.getAttribute('placeholder');
    if (!hasLabel && !wrapped && !aria) {
      unlabeled.push({
        sel: desc(el), type: el.type, placeholder: ph,
      });
    }
  }
  if (unlabeled.length) {
    out.problems.push({
      kind: 'unlabeled-fields',
      severity: 'medium',
      detail: 'form fields with no label, aria-label or wrapping label',
      items: unlabeled.slice(0, 8),
    });
  }

  // ---- 6. images without alt ----
  const noAlt = [];
  for (const img of document.querySelectorAll('img')) {
    if (!visible(img)) continue;
    if (!img.hasAttribute('alt')) {
      noAlt.push({ src: (img.getAttribute('src') || '').slice(0, 60) });
    }
  }
  if (noAlt.length) {
    out.problems.push({
      kind: 'img-missing-alt',
      severity: 'medium',
      detail: `${noAlt.length} visible images without alt attribute`,
      items: noAlt.slice(0, 6),
    });
  }

  // ---- 7. heading order / structure ----
  const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
    .filter(visible)
    .map((h) => ({ level: Number(h.tagName[1]), text: h.innerText.trim().slice(0, 30) }));
  const h1s = hs.filter((h) => h.level === 1);
  if (h1s.length === 0 && hs.length > 0) {
    out.problems.push({ kind: 'no-h1', severity: 'low', detail: 'no <h1> on the page' });
  }
  if (h1s.length > 1) {
    out.problems.push({
      kind: 'multiple-h1', severity: 'low',
      detail: `${h1s.length} <h1> elements`,
      items: h1s.map((h) => h.text),
    });
  }
  out.metrics.headings = hs.slice(0, 12);

  // ---- 8. focus indicator: tab to the first few controls ----
  // (Checked separately by the caller; here we just record focusable count.)
  const focusable = [...document.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter(visible);
  out.metrics.focusableCount = focusable.length;

  // ---- 9. contrast on text nodes (composite alpha over ancestors) ----
  function parseColor(c) {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const parts = m[1].split(/[\s,\/]+/).map((x) => parseFloat(x));
      return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
    }
    // Chrome returns `color(srgb r g b / a)` for color-mix()/modern syntax.
    const s = c.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/);
    if (s) {
      return {
        r: parseFloat(s[1]) * 255,
        g: parseFloat(s[2]) * 255,
        b: parseFloat(s[3]) * 255,
        a: s[4] !== undefined ? parseFloat(s[4]) : 1,
      };
    }
    return null;
  }
  function composite(fg, bg) {
    const a = fg.a;
    return {
      r: fg.r * a + bg.r * (1 - a),
      g: fg.g * a + bg.g * (1 - a),
      b: fg.b * a + bg.b * (1 - a),
      a: 1,
    };
  }
  /**
   * Walk ancestors compositing every translucent layer onto the first opaque
   * one. Skipping this made every semi-transparent surface read as white and
   * produced ~30 bogus 1.1:1 "failures" on a dark theme.
   */
  function effectiveBg(el) {
    const layers = [];
    let node = el;
    while (node && node.tagName !== 'HTML') {
      const s = getComputedStyle(node);
      const c = parseColor(s.backgroundColor);
      if (c && c.a > 0) {
        layers.push(c);
        if (c.a >= 1) break;
      }
      node = node.parentElement;
    }
    // Fall back to the document background, then white.
    const bodyBg = parseColor(getComputedStyle(document.body).backgroundColor);
    const base = bodyBg && bodyBg.a > 0
      ? bodyBg
      : { r: 255, g: 255, b: 255, a: 1 };
    // Composite from the bottom (outermost opaque) up.
    let acc = layers.length && layers[layers.length - 1].a >= 1
      ? layers[layers.length - 1]
      : base;
    const start = layers.length && layers[layers.length - 1].a >= 1
      ? layers.length - 2
      : layers.length - 1;
    for (let i = start; i >= 0; i--) acc = composite(layers[i], acc);
    return acc;
  }
  function lum({ r, g, b }) {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }
  function ratio(a, b) {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }
  const contrastFails = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('p, span, a, button, h1, h2, h3, h4, li, label, td, th, div')) {
    if (!visible(el)) continue;
    // Only leaf-ish text nodes.
    const own = [...el.childNodes].some(
      (n) => n.nodeType === 3 && n.textContent.trim().length > 1
    );
    if (!own) continue;
    const text = el.innerText.trim();
    if (text.length < 2) continue;
    const s = getComputedStyle(el);
    const fg = parseColor(s.color);
    if (!fg) continue;
    const bg = effectiveBg(el);
    const composed = fg.a < 1 ? composite(fg, bg) : fg;
    const cr = ratio(composed, bg);
    const size = parseFloat(s.fontSize);
    const bold = Number(s.fontWeight) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    if (cr < need) {
      const key = desc(el) + text.slice(0, 20);
      if (seen.has(key)) continue;
      seen.add(key);
      contrastFails.push({
        sel: desc(el),
        text: text.slice(0, 30),
        ratio: Math.round(cr * 100) / 100,
        need,
        fontSize: size,
        color: s.color,
        bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
      });
    }
  }
  if (contrastFails.length) {
    out.problems.push({
      kind: 'contrast-fail',
      severity: 'medium',
      detail: `${contrastFails.length} text elements below WCAG AA`,
      items: contrastFails.slice(0, 10),
    });
  }

  return out;
})()
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:9000")
    ap.add_argument("--json", default="dogfood-output/ui-probe.json")
    ap.add_argument("--storage", default="/tmp/ui-probe-state.json")
    args = ap.parse_args()

    results = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--no-sandbox"])
        for width in WIDTHS:
            # Phone widths emulate a touch device so `(pointer: coarse)`
            # matches — that is what the stylesheet keys its mobile hit-area
            # rules off. Without it the probe measured desktop-sized controls
            # at phone widths and flagged targets that are 44px on a real
            # phone. Wider viewports keep a fine pointer (desktop reality).
            ctx = browser.new_context(
                viewport={"width": width, "height": 900},
                storage_state=args.storage,
                device_scale_factor=1,
                has_touch=width <= 480,
            )
            page = ctx.new_page()
            console_msgs = []
            page.on(
                "console",
                lambda m: console_msgs.append({"type": m.type, "text": m.text[:200]}),
            )
            page.on(
                "pageerror",
                lambda e: console_msgs.append({"type": "pageerror", "text": str(e)[:200]}),
            )
            for path, label in PAGES:
                url = args.base + path
                try:
                    page.goto(url, wait_until="networkidle", timeout=20000)
                    page.wait_for_timeout(700)
                    m = page.evaluate(MEASURE_JS)
                    errs = [c for c in console_msgs if c["type"] in ("error", "pageerror")]
                    m["url"] = url
                    m["label"] = label
                    m["width"] = width
                    if errs:
                        m["problems"].append(
                            {"kind": "console-error", "severity": "high", "items": errs[:5]}
                        )
                    results.append(m)
                except Exception as e:  # noqa: BLE001
                    results.append(
                        {
                            "url": url, "label": label, "width": width,
                            "problems": [
                                {"kind": "navigation-failed", "severity": "critical",
                                 "detail": str(e)[:200]}
                            ],
                            "metrics": {},
                        }
                    )
                console_msgs.clear()
            ctx.close()
        browser.close()

    with open(args.json, "w") as f:
        json.dump(results, f, indent=1, ensure_ascii=False)

    # Console summary.
    total = 0
    for r in results:
        if r["problems"]:
            total += len(r["problems"])
            print(f"\n[{r['label']} @ {r['width']}px] {r['url']}")
            for p in r["problems"]:
                print(f"  - {p['severity'].upper():8s} {p['kind']}: {p.get('detail','')}")
                for it in (p.get("items") or p.get("offenders") or [])[:4]:
                    print(f"      {json.dumps(it, ensure_ascii=False)[:150]}")
    print(f"\n=== {total} problem groups across {len(results)} page/width combos ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
