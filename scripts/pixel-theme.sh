#!/usr/bin/env bash
# Refresh docs/.vitepress/theme/pixel.css from the live pixelbar.nl/pixel site.
#
# /pixel is itself a VitePress site, so its stylesheet already maps the Pixel
# design tokens onto the --vp-* variables this site uses. We lift that section
# verbatim: everything from Pixel's own token block up to the point where
# VitePress's scoped component CSS ([data-v-...]) resumes.
#
# See AGENTS.md, "Updating the theme from /pixel".
set -euo pipefail

base="${PIXEL_URL:-https://pixelbar.nl/pixel}"
out="${1:-docs/.vitepress/theme/pixel.css}"

href=$(curl -fsSL "$base/" | grep -oE '/pixel/assets/style\.[^"]+\.css' | head -1)
[ -n "$href" ] || { echo "No stylesheet link found on $base/" >&2; exit 1; }

origin=${base%/pixel}
curl -fsSL "$origin$href" | python3 -c '
import re, sys

css = sys.stdin.read()

# Pixel declares its tokens in a :root block carrying --spectrum-cyan; plain
# VitePress has :root blocks of its own, so key on a token only Pixel defines.
start = re.search(r":root\{[^{}]*--spectrum-cyan", css)
if not start:
    sys.exit("No Pixel token block in the stylesheet; has /pixel changed its theme?")

theme = css[start.start():]

# Pixel appends its theme after VitePress CSS, but VitePress emits per-component
# scoped rules last. Stop at the first of those rather than shipping the lot.
scoped = theme.find("[data-v-")
if scoped == -1:
    sys.exit("Expected VitePress scoped rules after the Pixel theme; stylesheet layout changed.")

theme = theme[: theme.rindex("}", 0, scoped) + 1]
sys.stdout.write(theme + "\n")
' > "$out.tmp"

# A truncated download must not quietly blank the theme.
bytes=$(wc -c < "$out.tmp")
[ "$bytes" -gt 10000 ] || { echo "Only $bytes bytes extracted; refusing to overwrite $out" >&2; rm -f "$out.tmp"; exit 1; }

mv "$out.tmp" "$out"
echo "Wrote $out ($bytes bytes) from $origin$href"
