#!/usr/bin/env python3
"""
UI regression assertions for ModelHub.

Each check is a *measured* property, not a screenshot opinion. Run after any
UI change:

    python3 scripts/ui_checks.py

Exits non-zero when a check fails, so it can gate a build.
"""
import json
import sys

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:9000"
STATE = "/tmp/ui-probe-state.json"

# (path, label, provider/slug placeholders resolved below)
PAGES = [
    ("/", "home"),
    ("/login", "login"),
    ("/console", "console-overview"),
    ("/console/providers", "console-providers"),
    ("/console/providers/{provider}", "console-provider-edit"),
    ("/console/profile", "console-profile"),
    ("/console/account", "console-account"),
    ("/console/users", "console-users"),
    ("/console/stats", "console-stats"),
    ("/console/settings", "console-settings"),
    ("/providers/{provider}", "provider-detail"),
    ("/p/{slug}", "personal-page"),
]

WIDTHS = [320, 390, 768, 1024, 1440]

# WCAG AA: 4.5:1 normal text, 3:1 large text.
MIN_RATIO_NORMAL = 4.5

CHECK_JS = r"""
(() => {
  const vw = window.innerWidth;
  const out = { vw, docScrollWidth: document.documentElement.scrollWidth, fails: [] };

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity || '1') > 0;
  };

  // --- A. no horizontal document overflow ---
  if (out.docScrollWidth > vw + 1) {
    const culprits = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.right <= vw + 1) continue;
      // Skip anything inside a horizontal scroller (that is intentional).
      let p = el.parentElement, inScroller = false;
      while (p && p !== document.body) {
        const ps = getComputedStyle(p);
        if (ps.overflowX === 'auto' || ps.overflowX === 'scroll') { inScroller = true; break; }
        p = p.parentElement;
      }
      if (inScroller) continue;
      culprits.push({
        sel: el.tagName.toLowerCase() + '.' + (typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0,2).join('.') : ''),
        right: Math.round(r.right), width: Math.round(r.width),
        text: (el.innerText || '').trim().slice(0, 30),
      });
    }
    out.fails.push({
      kind: 'doc-overflow-x',
      detail: `scrollWidth ${out.docScrollWidth} > viewport ${vw}`,
      culprits: culprits.slice(0, 5),
    });
  }

  // --- B. no interactive element horizontally off-screen ---
  const off = [];
  for (const el of document.querySelectorAll('button, a[href], input, select, textarea')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    let p = el.parentElement, inScroller = false;
    while (p && p !== document.body) {
      const ps = getComputedStyle(p);
      if (ps.overflowX === 'auto' || ps.overflowX === 'scroll') { inScroller = true; break; }
      p = p.parentElement;
    }
    if (inScroller) continue;
    if (r.right > vw + 1 || r.left < -1) {
      off.push({
        sel: el.tagName.toLowerCase() + '.' + (typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : ''),
        text: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 24),
        left: Math.round(r.left), right: Math.round(r.right),
      });
    }
  }
  if (off.length) out.fails.push({ kind: 'controls-offscreen', culprits: off.slice(0, 5) });

  // --- C. text contrast (alpha composited over ancestors) ---
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
  const contrastFails = [];
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
      const key = el.tagName + '.' + (typeof el.className === 'string' ? el.className : '') + text.slice(0, 15);
      if (seen.has(key)) continue;
      seen.add(key);
      contrastFails.push({
        sel: el.tagName.toLowerCase() + '.' + (typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : ''),
        text: text.slice(0, 24),
        ratio: Math.round(cr * 100) / 100,
        need,
        fontSize: size,
        color: s.color,
        bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
      });
    }
  }
  if (contrastFails.length) {
    out.fails.push({ kind: 'contrast-fail', culprits: contrastFails.slice(0, 12) });
  }

  // --- D. form fields must have an accessible name ---
  const unlabeled = [];
  for (const el of document.querySelectorAll('input, select, textarea')) {
    if (!visible(el) || el.type === 'hidden') continue;
    const id = el.id;
    const hasLabel = id && document.querySelector(`label[for="${CSS.escape(id)}"]`);
    const wrapped = el.closest('label');
    const aria = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
    if (!hasLabel && !wrapped && !aria) {
      unlabeled.push({
        sel: el.tagName.toLowerCase() + '.' + (typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : ''),
        type: el.type, placeholder: el.getAttribute('placeholder'),
      });
    }
  }
  if (unlabeled.length) out.fails.push({ kind: 'unlabeled-fields', culprits: unlabeled.slice(0, 6) });

  return out;
})()
"""


def main():
    base = sys.argv[1] if len(sys.argv) > 1 else BASE
    # Resolve the placeholder pages against the live instance.
    import urllib.request
    def api(path):
        req = urllib.request.Request(base + path)
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.load(r)

    try:
        providers = api("/api/providers")["providers"]
        provider_id = providers[0]["id"] if providers else None
    except Exception:
        provider_id = None

    # The personal page needs a real slug, so resolve it from the logged-in
    # session's status payload (the storage state holds the session cookie).
    # Without this the page was silently dropped and never actually checked.
    slug = None
    try:
        state = json.load(open(STATE))
        cookie_header = "; ".join(
            f"{c['name']}={c['value']}" for c in state.get("cookies", [])
            if c.get("name") and c.get("value")
        )
        req = urllib.request.Request(base + "/api/auth/status")
        if cookie_header:
            req.add_header("Cookie", cookie_header)
        with urllib.request.urlopen(req, timeout=10) as r:
            slug = (json.load(r).get("user") or {}).get("slug") or None
    except Exception:
        slug = None
    if not slug:
        print("WARN: no personal-page slug available; /p/{slug} will be skipped")

    pages = []
    for path, label in PAGES:
        p = path.replace("{provider}", provider_id or "")
        if "{slug}" in p:
            if not slug:
                continue  # no slug on this instance; warned above
            p = p.replace("{slug}", slug)
        pages.append((p, label))

    failures = []
    checked = 0
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--no-sandbox"])
        for width in WIDTHS:
            ctx = browser.new_context(
                viewport={"width": width, "height": 900},
                storage_state=STATE,
            )
            page = ctx.new_page()
            console_errs = []
            page.on("console", lambda m: console_errs.append(m.text[:160]) if m.type == "error" else None)
            page.on("pageerror", lambda e: console_errs.append("PAGEERROR: " + str(e)[:160]))
            for path, label in pages:
                page.goto(base + path, wait_until="networkidle", timeout=25000)
                page.wait_for_timeout(600)
                checked += 1
                res = page.evaluate(CHECK_JS)
                for f in res["fails"]:
                    failures.append({
                        "label": label, "width": width, "path": path, **f,
                    })
                if console_errs:
                    failures.append({
                        "label": label, "width": width, "path": path,
                        "kind": "console-error", "culprits": console_errs[:3],
                    })
                console_errs.clear()
            ctx.close()
        browser.close()

    if not failures:
        print(f"OK — {checked} page/width combos, no measured UI defects")
        return 0

    print(f"{len(failures)} measured defects across {checked} page/width combos:\n")
    for f in failures:
        print(f"[{f['label']} @ {f['width']}px] {f['kind']}: {f.get('detail','')}")
        for c in f.get("culprits", [])[:4]:
            print(f"    {json.dumps(c, ensure_ascii=False)[:170]}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
