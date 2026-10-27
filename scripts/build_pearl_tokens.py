"""Generate static/pearl/tokens.css from the Pearl design system's tokens.json.

Run after refreshing tokens.json:  python scripts/build_pearl_tokens.py
The first theme (Pearl) goes on :root; other themes go on [data-theme="<id>"].
"""

import json
from pathlib import Path

PEARL = Path(__file__).resolve().parent.parent / "static" / "pearl"


def main():
    tokens = json.loads((PEARL / "tokens.json").read_text())
    themes = [t["id"] for t in tokens["color"]["themes"]]
    blocks = {theme: [] for theme in themes}

    def add(name, value):
        if isinstance(value, dict):
            for theme in themes:
                if theme in value:
                    blocks[theme].append(f"  --{name}: {value[theme]};")
        else:
            blocks[themes[0]].append(f"  --{name}: {value};")

    for family in ("color", "spacing", "radius", "shadow"):
        for token in tokens.get(family, {}).get("tokens", []):
            add(token["name"], token["value"])
    for name, stack in tokens["type"]["families"].items():
        add(f"font-{name}", stack)

    css = [f"/* {tokens['name']} — generated from tokens.json by scripts/build_pearl_tokens.py */"]
    for i, theme in enumerate(themes):
        selector = f':root, [data-theme="{theme}"]' if i == 0 else f'[data-theme="{theme}"]'
        css += [f"{selector} {{", *blocks[theme], "}"]
    (PEARL / "tokens.css").write_text("\n".join(css) + "\n")
    print(f"wrote {PEARL / 'tokens.css'}")


if __name__ == "__main__":
    main()
