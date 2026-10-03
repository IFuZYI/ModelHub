#!/usr/bin/env python3
"""
Light-theme + responsive-boundary checks.

ui_checks.py runs the default (dark) theme. This adds:
  1. the light theme, where every text token must clear WCAG AA against the
     light surfaces (#f3f3f3 worst case), and
  2. the nav boundary band — asserting that navigation is reachable at EVERY
     width, i.e. the desktop nav and the mobile menu are never BOTH hidden.
"""
import json
import sys

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:9000"
STATE = "/tmp/ui-probe-state.json"

CONTRAST_JS = r"""
(() => {
  function parseColor(c) {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const p = m[1].split(/[\s,\/]+/).map(parseFloat);
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    }
    const s = c.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/);
    if (s) return { r: +s[1]*255, g: +s[2]*255, b: +s[3]*255, a: s[4] !== undefined ? +s[4] : 1 };
    return null;
  }
  const comp = (f, b) => ({
    r: f.r*f.a + b.r*(1-f.a), g: f.g*f.a + b.g*(1-f.a), b: f.b*f.a + b.b*(1-f.a), a: 1,
  });
  function bgOf(el) {
    const layers = [];
    let n = el;
    while (n && n.tagName !== 'HTML') {
      const c = parseColor(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
      n = n.parentElement;
    }
    const bb = parseColor(getComputedStyle(document.body).backgroundColor);
    const base = bb && bb.a > 0 ? bb : { r: 255, g: 255, b: 255, a: 1 };
    let acc = layers.length && layers[layers.length-1].a >= 1 ? layers[layers.length-1] : base;
    const start = layers.length && layers[layers.length-1].a >= 1 ? layers.length-2 : layers.length-1;
    for (let i = start; i >= 0; i--) acc = comp(layers[i], acc);
    return acc;
  }
  function lum({ r, g, b }) {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); };
    return 0.2126*f(r) + 0.7152*f(g) + 0.0722*f(b);
  }
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity || '1') > 0;
  };
  const fails = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('p, span, a, button, h1, h2, h3, h4, li, label, td, th, div')) {
    if (!visible(el)) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!own) continue;
    const text = el.innerText.trim();
    if (text.length < 2) continue;
    const s = getComputedStyle(el);
    const fg = parseColor(s.color);
    if (!fg) continue;
    const bg = bgOf(el);
    const composed = fg.a < 1 ? comp(fg, bg) : fg;
    const cr = ratio(composed, bg);
    const size = parseFloat(s.fontSize);
    const bold = Number(s.fontWeight) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    if (cr < need) {
      const key = el.tagName + (typeof el.className === 'string' ? el.className : '') + text.slice(0, 12);
      if (seen.has(key)) continue;
      seen.add(key);
      fails.push({
        sel: el.tagName.toLowerCase() + '.' + (typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : ''),
        text: text.slice(0, 22), ratio: Math.round(cr*100)/100, need,
        color: s.color, bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
      });
    }
  }
  return { theme: document.documentElement.getAttribute('data-theme'), fails };
})()
"""

NAV_JS = r"""
(() => {
  const vis = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
  };
  // Console pages: the sidebar is hidden below 860px, so the drawer toggle
  // must take over. Both hidden == navigation is unreachable.
  const sidebar = vis('.console-side.open') || vis('.console-side');
  const drawer = vis('.console-drawer-toggle');
  // Public pages: the header carries the links (no rail at any width).
  const header = vis('.site-header');
  const headerLink = vis('.site-header a[href], .header-actions a, .header-actions button');
  return {
    vw: window.innerWidth,
    sidebar, drawer, header, headerLink,
    isConsole: !!document.querySelector('.console-shell'),
  };
})()
"""

PAGES = ["/", "/console", "/console/providers", "/console/settings"]


def main():
    problems = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--no-sandbox"])

        # ---- 1. light theme contrast ----
        # The theme lives in localStorage and useTheme() re-applies it on
        # mount, so set the stored value BEFORE navigating — flipping the
        # attribute afterwards is overwritten by React. The app also swaps the
        # `data-theme` attribute after hydration, so wait for it to settle
        # before measuring (measuring mid-swap reports the old palette).
        ctx = browser.new_context(viewport={"width": 1440, "height": 900}, storage_state=STATE)
        page = ctx.new_page()
        page.goto(BASE, wait_until="domcontentloaded")
        page.evaluate("localStorage.setItem('modelhub-theme','light')")
        for path in ["/", "/console", "/console/users", "/console/settings", "/console/stats"]:
            page.goto(BASE + path, wait_until="networkidle")
            # Wait until the attribute is light AND the body fill matches the
            # light --bg, so we never measure a half-applied theme.
            page.wait_for_function(
                """() => {
                  const el = document.documentElement;
                  if (el.getAttribute('data-theme') !== 'light') return false;
                  const bg = getComputedStyle(document.body).backgroundColor;
                  return bg === 'rgb(255, 255, 255)';
                }""",
                timeout=8000,
            )
            page.wait_for_timeout(250)
            res = page.evaluate(CONTRAST_JS)
            if res["theme"] != "light":
                problems.append({"kind": "theme-not-applied", "path": path, "got": res["theme"]})
            for f in res["fails"]:
                problems.append({"kind": "light-contrast", "path": path, **f})
        ctx.close()

        # ---- 2. navigation reachable at every width ----
        ctx2 = browser.new_context(viewport={"width": 1440, "height": 900}, storage_state=STATE)
        page2 = ctx2.new_page()
        for path in PAGES:
            for width in range(320, 1441, 40):
                page2.set_viewport_size({"width": width, "height": 900})
                page2.goto(BASE + path, wait_until="domcontentloaded")
                page2.wait_for_timeout(260)
                r = page2.evaluate(NAV_JS)
                if r["isConsole"]:
                    # Console: the rail is visible, or the drawer toggle is.
                    if not r["sidebar"] and not r["drawer"]:
                        problems.append({
                            "kind": "nav-unreachable",
                            "path": path, "width": width,
                            "detail": "console sidebar hidden and no drawer toggle",
                        })
                else:
                    # Public: the header must be present with at least one link.
                    if not r["header"] or not r["headerLink"]:
                        problems.append({
                            "kind": "nav-unreachable",
                            "path": path, "width": width,
                            "detail": "header or its links are not visible",
                        })
        ctx2.close()
        browser.close()

    if not problems:
        print("OK — light theme passes AA on every page; navigation reachable at "
              "every width 320→1440 (40px steps)")
        return 0
    print(f"{len(problems)} problems:\n")
    for p in problems:
        print(" ", json.dumps(p, ensure_ascii=False))
    return 1


if __name__ == "__main__":
    sys.exit(main())
