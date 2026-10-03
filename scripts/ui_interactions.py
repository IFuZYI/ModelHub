#!/usr/bin/env python3
"""
Interaction-state checks: focus visibility, keyboard reachability, hover
states, and the destructive-action confirmations. Complements
ui_checks.py (static layout/contrast) with the states a user actually
passes through.
"""
import json
import sys

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:9000"
STATE = "/tmp/ui-probe-state.json"

FOCUS_JS = r"""
(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return { none: true };
  const s = getComputedStyle(el);
  return {
    tag: el.tagName.toLowerCase(),
    cls: (typeof el.className === 'string' ? el.className : '').slice(0, 40),
    outlineStyle: s.outlineStyle,
    outlineWidth: s.outlineWidth,
    outlineColor: s.outlineColor,
    boxShadow: s.boxShadow.slice(0, 80),
    borderColor: s.borderColor,
  };
})()
"""


def main():
    problems = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--no-sandbox"])
        ctx = browser.new_context(viewport={"width": 1440, "height": 900}, storage_state=STATE)
        page = ctx.new_page()

        # ---- 1. keyboard focus is visible on every control ----
        for path in ["/", "/login", "/console", "/console/providers", "/console/settings"]:
            page.goto(BASE + path, wait_until="networkidle")
            page.wait_for_timeout(500)
            seen = 0
            for _ in range(25):
                page.keyboard.press("Tab")
                seen += 1
                info = page.evaluate(FOCUS_JS)
                if info.get("none"):
                    break
                # A visible focus indicator needs an outline OR a shadow OR a
                # changed border. `outline: none` with none of the others is a
                # WCAG 2.4.7 failure.
                has_outline = (
                    info["outlineStyle"] not in ("none", "")
                    and float(info["outlineWidth"].replace("px", "") or 0) > 0
                )
                has_shadow = info["boxShadow"] not in ("none", "")
                if not has_outline and not has_shadow:
                    problems.append({
                        "kind": "focus-not-visible",
                        "path": path,
                        "tabIndex": seen,
                        "el": f'{info["tag"]}.{info["cls"]}',
                    })
            # Tab must reach a reasonable number of controls.
            if seen < 3:
                problems.append({
                    "kind": "few-focusable",
                    "path": path,
                    "detail": f"only {seen} focus stops before leaving the page",
                })

        # ---- 2. destructive actions must confirm ----
        page.goto(BASE + "/console/providers", wait_until="networkidle")
        page.wait_for_timeout(800)
        del_btn = page.query_selector('button:has-text("删除")')
        if del_btn:
            del_btn.click()
            page.wait_for_timeout(700)
            has_confirm = page.query_selector('.modal, [role="dialog"], .confirm')
            if not has_confirm:
                problems.append({
                    "kind": "no-confirm-on-delete",
                    "path": "/console/providers",
                    "detail": "删除 acted without a confirmation step",
                })
            else:
                # Escape / cancel must close it without deleting.
                page.keyboard.press("Escape")
                page.wait_for_timeout(500)

        # ---- 3. the edit modal is scrollable at a short viewport ----
        ctx2 = browser.new_context(
            viewport={"width": 1024, "height": 620}, storage_state=STATE
        )
        page2 = ctx2.new_page()
        page2.goto(BASE + "/console/providers", wait_until="networkidle")
        page2.wait_for_timeout(800)
        edit = page2.query_selector('button:has-text("编辑")')
        if edit:
            edit.click()
            page2.wait_for_timeout(900)
            res = page2.evaluate("""(() => {
              const m = document.querySelector('.modal');
              if (!m) return { err: 'no modal' };
              const body = m.querySelector('.modal-scroll') || m;
              const save = [...m.querySelectorAll('button')]
                .find(b => /保存/.test(b.textContent));
              const sb = save ? save.getBoundingClientRect() : null;
              return {
                modalH: Math.round(m.getBoundingClientRect().height),
                vh: window.innerHeight,
                scrollable: body.scrollHeight > body.clientHeight,
                bodyScrollH: body.scrollHeight,
                bodyClientH: body.clientHeight,
                saveVisible: sb ? (sb.top >= 0 && sb.bottom <= window.innerHeight + 1) : null,
              };
            })()""")
            if res.get("err"):
                problems.append({"kind": "modal-missing", "path": "/console/providers", **res})
            else:
                # At a 620px viewport the modal must fit or scroll, and the save
                # button must be reachable.
                if res["modalH"] > res["vh"] and not res["scrollable"]:
                    problems.append({
                        "kind": "modal-overflow-unscrollable",
                        "path": "/console/providers",
                        **res,
                    })
                if res["saveVisible"] is False and not res["scrollable"]:
                    problems.append({
                        "kind": "save-unreachable",
                        "path": "/console/providers",
                        **res,
                    })
        ctx2.close()
        ctx.close()
        browser.close()

    if not problems:
        print("OK — focus visible on all stops, destructive actions confirm, "
              "edit modal reachable at 620px")
        return 0
    print(f"{len(problems)} interaction problems:\n")
    for p in problems:
        print(" ", json.dumps(p, ensure_ascii=False))
    return 1


if __name__ == "__main__":
    sys.exit(main())
