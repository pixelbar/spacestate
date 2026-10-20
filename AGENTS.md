# AGENTS.md

Notes for anyone (human or agent) working in this repo. Start with `README.md`
for what the service is and how to run it; this file covers the things that are
easy to get wrong.

## The API reference site

`https://pixelbar.nl/spacestate/` — the OpenAPI spec rendered with
[Scalar](https://github.com/scalar/scalar), themed to match
[pixelbar.nl/pixel](https://pixelbar.nl/pixel).

Three files, and that is the whole site:

| File | Role |
| --- | --- |
| `docs/openapi.yaml` | The spec. The only file you edit to change what the docs say. |
| `docs/reference.html` | The page: Scalar's loader plus the Pixel theme. Static; no spec content in it. |
| `scripts/build-docs.ts` | Copies those two into `docs/dist/` as `index.html` + `openapi.yaml`. |

### Changing what the docs say

Edit `docs/openapi.yaml`. Nothing else. The page fetches the spec in the
browser at runtime, so there is no generation step that bakes spec content into
HTML, and no "regenerate the docs" command to forget. Push to `main` and
`.github/workflows/docs.yml` republishes.

Validate before pushing (CI runs the same check, and an invalid spec means a
blank page):

```sh
npx @redocly/cli lint docs/openapi.yaml
```

Don't use YAML anchors or merge keys (`&x`, `<<: *x`) in the spec. YAML 1.2
parsers ignore `<<` by default, so tools like yaml@2 and js-yaml silently drop
the merged fields (the legacy operations once lost `tags` and `deprecated`
that way) even though Scalar renders them fine. Write shared operations out in
full, or share through `$ref` into `components`.

Warnings are expected — `operation-4xx-response` and `tag-description` fire
across the existing spec. Keep the count from growing; don't chase it to zero.

Preview locally:

```sh
just docs-preview     # builds, then serves http://localhost:8000
```

To show someone else on the tailnet, serve that port instead of publishing a
draft:

```sh
just docs-build
python3 -m http.server 8000 --directory docs/dist &
tailscale serve --bg --set-path /spacestate http://localhost:8000
tailscale serve --set-path /spacestate off    # when you're done
```

`tailscale serve` is tailnet-only. Do not reach for `tailscale funnel` here;
publishing is what Pages is for.

### Updating the theme from /pixel

`docs/reference.html` carries a **copy** of the `/pixel` design tokens, because
a Pages site cannot read another origin's CSS variables. `pixelbar/pixel` stays
the source of truth; this copy has to be refreshed by hand when it changes.

1. Pull the current tokens out of the live site:

   ```sh
   just pixel-tokens
   ```

   `:root` is light mode, `.dark` is dark mode. The script fails loudly if
   `/pixel` restructures its theme, rather than printing the wrong block.

2. Copy the values into the `.light-mode` / `.dark-mode` blocks at the top of
   `docs/reference.html`. Those blocks are deliberately verbatim Pixel token
   names (`--bg`, `--ink-muted`, `--spectrum-cyan`, …). Only the block below
   them maps those onto Scalar's `--scalar-*` variables — if `/pixel` adds a
   token you want to use, add the mapping there, not a second copy of the value.

3. Fonts come from Google Fonts (IBM Plex Sans/Mono, Pixelify Sans) rather than
   `/pixel`'s self-hosted copies, which are same-origin to that site only. If
   `/pixel` changes typeface, change the `<link>` and `--scalar-font*`.

4. `just docs-preview` and check both modes — the toggle is bottom-left.

### Bumping Scalar

The CDN script is pinned with a Subresource Integrity hash, so the version and
the hash move together or the page silently fails to load. The command to
recompute is in a comment next to the `<script>` tag in `docs/reference.html`.
Check both light and dark after bumping: the theme rides on Scalar's CSS
variable names, and a major version can rename them.

`docs/reference.html` also overrides some Scalar defaults, all of which a
version bump can undo (cosmetic, not breakage):

- `.explore-scalar` and `.scalar-reference-intro-clients` are hidden by CSS:
  the "Generate SDKs & MCP" upsell and the "Client Libraries" card. Neither has
  a config flag.
- `hideClientButton: true` removes the "Open API Client" launcher.
- `authentication.securitySchemes` sets placeholder credentials
  (`<your-api-key>`, `<your-device-token>`). Without it Scalar invents fake
  tokens in the code samples. Never put a real credential there, and keep the
  docs from saying where keys come from: users are told to ask the Pixelbar
  board.
- `defaultOpenAllTags`, `expandAllParameters` and `expandAllResponses` keep
  every section expanded.

### Publishing

`.github/workflows/docs.yml` builds on every PR that touches `docs/`, and
publishes on push to `main` (or `workflow_dispatch` to republish by hand).
Pages must be set to "GitHub Actions" as its source — once, by an admin:

```sh
gh api -X POST repos/pixelbar/spacestate/pages -f build_type=workflow
```

The service itself does **not** serve the docs. `/docs` on
`spacestate.pixelbar.nl` is deliberately not a route: the spec is static and
Pages hosts it for free, without the API needing to ship HTML.

One consequence worth knowing: Scalar's "Test Request" button fires a real
cross-origin request from `pixelbar.nl` at `spacestate.pixelbar.nl`. The `GET`
endpoints send `Access-Control-Allow-Origin: *` and work; `POST /api/v1/state`
does not set CORS headers, so trying it from the docs page fails in the
browser. Curl and the code samples are unaffected.

## Changelog

Every PR needs a `CHANGELOG.md` entry under `[Unreleased]`, enforced by CI. Add
the `skip-changelog` label for pure chores. `just check-changelog --base
origin/main` runs the same check locally.
