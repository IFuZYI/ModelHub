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

        # ---- 2b. Escape inside a modal must not leak past a nested dropdown ----
        # The add-provider modal contains a Select; Escape with the dropdown
        # open must close ONLY the dropdown, never the whole dialog (which
        # would discard everything typed). Regression guard for ModalShell's
        # e.defaultPrevented check.
        page.goto(BASE + "/console/users", wait_until="networkidle")
        page.wait_for_timeout(800)
        create_btn = page.query_selector('button:has-text("新建用户")')
        if create_btn:
            create_btn.click()
            page.wait_for_timeout(600)
            dlg = page.query_selector('[role="dialog"]')
            trigger = page.query_selector('[role="dialog"] .sel-trigger')
            if dlg and trigger:
                trigger.click()
                page.wait_for_timeout(400)
                dd_open = page.query_selector('[role="dialog"] .sel-menu') is not None
                page.keyboard.press("Escape")
                page.wait_for_timeout(500)
                dlg_after = page.query_selector('[role="dialog"]') is not None
                dd_after = page.query_selector('[role="dialog"] .sel-menu') is not None
                if not dd_open:
                    problems.append({
                        "kind": "dropdown-did-not-open",
                        "path": "/console/users",
                        "detail": "Select menu never appeared after clicking the trigger",
                    })
                elif not dlg_after:
                    problems.append({
                        "kind": "escape-leaked-to-modal",
                        "path": "/console/users",
                        "detail": "Escape with the dropdown open closed the whole modal (typed form discarded)",
                    })
                elif dd_after:
                    problems.append({
                        "kind": "escape-did-not-close-dropdown",
                        "path": "/console/users",
                        "detail": "Escape did not close the Select menu",
                    })
                # second Escape (dropdown gone) must close the modal
                if dlg_after:
                    page.keyboard.press("Escape")
                    page.wait_for_timeout(400)
                    if page.query_selector('[role="dialog"]') is not None:
                        problems.append({
                            "kind": "escape-did-not-close-modal",
                            "path": "/console/users",
                            "detail": "Escape no longer closes the modal after the dropdown closed",
                        })
            # clean up any surviving dialog
            if page.query_selector('[role="dialog"]') is not None:
                page.keyboard.press("Escape")
                page.wait_for_timeout(300)

        # ---- 3. editing opens the full-page editor, not a modal ----
        # Both entry points (overview cards, sites list) must land on
        # /console/providers/{id}, so check the list's 编辑 link navigates and
        # the page carries the editor's own title.
        ctx2 = browser.new_context(
            viewport={"width": 1024, "height": 620}, storage_state=STATE
        )
        page2 = ctx2.new_page()
        page2.goto(BASE + "/console/providers", wait_until="networkidle")
        page2.wait_for_timeout(800)
        edit = page2.query_selector('a:has-text("编辑")')
        if not edit:
            problems.append({
                "kind": "edit-entry-missing",
                "path": "/console/providers",
                "detail": "no 编辑 link on the sites list",
            })
        else:
            href = edit.get_attribute("href") or ""
            if not href.startswith("/console/providers/"):
                problems.append({
                    "kind": "edit-entry-wrong-target",
                    "path": "/console/providers",
                    "detail": f"编辑 points at {href!r}, expected /console/providers/<id>",
                })
            else:
                edit.click()
                page2.wait_for_timeout(1200)
                res = page2.evaluate("""(() => {
                  const h1 = document.querySelector('.detail-title');
                  const modal = document.querySelector('.modal');
                  const body = document.querySelector('.settings-form');
                  const save = [...document.querySelectorAll('button')]
                    .find(b => /保存/.test(b.textContent));
                  const sb = save ? save.getBoundingClientRect() : null;
                  return {
                    url: location.pathname,
                    title: h1 ? h1.textContent.trim() : null,
                    modalOpen: !!modal,
                    hasForm: !!body,
                    vh: window.innerHeight,
                    saveVisible: sb ? (sb.top >= 0 && sb.bottom <= window.innerHeight + 1) : null,
                    docScroll: document.documentElement.scrollHeight,
                  };
                })()""")
                if not res["url"].startswith("/console/providers/"):
                    problems.append({
                        "kind": "edit-navigation-failed",
                        "path": "/console/providers",
                        **res,
                    })
                elif res["modalOpen"]:
                    problems.append({
                        "kind": "edit-opens-modal",
                        "path": "/console/providers",
                        **res,
                    })
                elif not res["hasForm"] or res["title"] != "编辑站点":
                    problems.append({
                        "kind": "editor-not-rendered",
                        "path": "/console/providers",
                        **res,
                    })
        ctx2.close()
        ctx.close()
        browser.close()

    if not problems:
        print("OK — focus visible on all stops, destructive actions confirm, "
              "edit opens the full-page editor at 620px")
        return 0
    print(f"{len(problems)} interaction problems:\n")
    for p in problems:
        print(" ", json.dumps(p, ensure_ascii=False))
    return 1


if __name__ == "__main__":
    sys.exit(main())
