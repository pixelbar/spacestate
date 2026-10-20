#!/usr/bin/env bash
# Print the current pixelbar.nl/pixel design tokens, light (:root) and dark
# (.dark), for copying into the matching blocks in docs/reference.html.
# See AGENTS.md, "Updating the theme from /pixel".
set -euo pipefail

base="${1:-https://pixelbar.nl/pixel}"

css=$(curl -fsSL "$base/" | grep -oE '/pixel/assets/style\.[^"]+\.css' | head -1)
[ -n "$css" ] || { echo "Could not find the stylesheet link on $base/" >&2; exit 1; }

echo "# from https://pixelbar.nl$css"
curl -fsSL "https://pixelbar.nl$css" | python3 -c '
import re, sys

css = sys.stdin.read()
# The token block is the one carrying --spectrum-cyan; VitePress declares its
# own :root/.dark rules too, so match on a token only Pixel defines.
for selector in (":root", ".dark"):
    match = re.search(re.escape(selector) + r"\{([^{}]*--spectrum-cyan[^{}]*)\}", css)
    if not match:
        sys.exit(f"No Pixel token block found for {selector}; has /pixel changed its theme?")
    print(f"\n{selector} {{")
    print("  " + match.group(1).replace(";", ";\n  ") + ";")
    print("}")
'
