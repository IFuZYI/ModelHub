#!/usr/bin/env python3
"""
Associate every bare JSX <label> with the form control it describes.

Strategy (mechanical, no JSX re-parsing): for a `<label>text</label>` whose
next sibling element is a control, add `htmlFor="<id>"` to the label and
`id="<id>"` to the control. Ids are derived from the file path + line number,
so re-running is a no-op and the diff is stable.

Controls that already carry an id are reused. Labels that wrap their control
already satisfy the association and are left alone.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIRS = ["app/console", "app/components", "app/login", "app/providers", "app/p"]
CONTROL = re.compile(r"<(input|select|textarea|Select)\b")

# <label>text</label>   (single-line text, may contain JSX expressions)
LABEL = re.compile(r"<label(?P<attrs>\b[^>]*)>(?P<text>(?:[^<]|<[^/]|\n)*?)</label>")


def slug(path: Path, line: int) -> str:
    stem = path.stem.replace("page", "").strip("_") or path.parent.name
    stem = re.sub(r"[^a-z0-9]+", "-", stem.lower()).strip("-") or "field"
    return f"{stem}-{line}"


def process(path: Path) -> list[str]:
    src = path.read_text()
    changes: list[str] = []
    out = src
    # Work backwards so earlier offsets stay valid.
    matches = list(LABEL.finditer(src))
    for m in reversed(matches):
        attrs = m.group("attrs")
        if "htmlFor" in attrs:
            continue
        after = src[m.end():]
        # Skip whitespace/newlines to the next element.
        stripped = after.lstrip()
        if not stripped.startswith("<"):
            continue
        ctl = CONTROL.match(stripped)
        if not ctl:
            continue
        # Already wrapping? (the control sits before </label>) — not our case
        # here since we matched a closed label; nothing to do.
        line = src[: m.start()].count("\n") + 1
        fid = slug(path, line)

        # Does the control already have an id?
        ctl_start = m.end() + (len(after) - len(stripped))
        ctl_tag_end = out.find(">", ctl_start)
        ctl_tag = out[ctl_start:ctl_tag_end]
        existing = re.search(r'\bid="([^"]+)"', ctl_tag)
        if existing:
            fid = existing.group(1)
            new_ctl_tag = ctl_tag
        else:
            # Insert id right after the tag name.
            new_ctl_tag = ctl_tag.replace(
                "<" + ctl.group(1), f'<{ctl.group(1)} id="{fid}"', 1
            )

        # 1) add htmlFor to the label
        new_label_open = f'<label htmlFor="{fid}"{attrs}>'
        # 2) add id to the control
        new_out = (
            out[: m.start()]
            + new_label_open
            + m.group("text")
            + "</label>"
            + out[m.end(): ctl_start]
            + new_ctl_tag
            + out[ctl_tag_end:]
        )
        out = new_out
        changes.append(f"  {path.relative_to(ROOT)}:{line}  {fid}")

    if out != src:
        path.write_text(out)
    return changes


def main() -> int:
    all_changes: list[str] = []
    for d in DIRS:
        base = ROOT / d
        if not base.exists():
            continue
        for f in sorted(base.rglob("*.tsx")):
            all_changes += process(f)
    print("\n".join(all_changes) if all_changes else "no changes")
    print(f"\n{len(all_changes)} labels associated")
    return 0


if __name__ == "__main__":
    sys.exit(main())
