# AGENTS.md

Notes for anyone (human or agent) working in this repo. Start with `README.md`
for what the service is and how to run it; this file covers the things that are
easy to get wrong.

## The API reference site

`https://pixelbar.nl/spacestate/` — the OpenAPI spec rendered with
[vitepress-openapi](https://github.com/enzonotario/vitepress-openapi), themed to
match [pixelbar.nl/pixel](https://pixelbar.nl/pixel).

| Path | Role |
| --- | --- |
| `docs/openapi.yaml` | The spec. The only file you edit to change what the API reference says. |
| `docs/index.md`, `docs/all.md`, `docs/operations/` | Three pages, each one component. No spec content in them. |
| `docs/maintainers/` | Hand-written pages for whoever runs the service (Maintainers in the nav). Not generated. |
| `docs/.vitepress/config.mts` | Site shell: nav, sidebars (the API one generated from the spec, the Maintainers one by hand), fonts. |
| `docs/.vitepress/theme/pixel.css` | A copy of the /pixel theme. Generated — see below. |
| `docs/.vitepress/theme/openapi.css` | What Pixel does not cover: the library's own components. |
| `scripts/build-docs.ts` | Spec → `.vitepress/openapi.json` + `public/openapi.yaml`, then VitePress. |

The spec is read at build time, not in the browser: the pages import the JSON
that `scripts/build-docs.ts` writes. `docs/public/openapi.yaml` is a verbatim
copy, published next to the site for codegen.

### Changing what the docs say

The site has two halves. The API reference is generated from the spec, as
below. The Maintainers section (`docs/maintainers/`) is ordinary VitePress
markdown that explains how the service behaves for the people running it; a
change to that behaviour updates its page in the same PR, and a new page also
needs an entry in `maintainersSidebar` in `config.mts`.

Diagrams in those pages are ```` ```mermaid ```` fences, drawn in the browser by
`docs/.vitepress/theme/Mermaid.vue` with the Pixel colours (and redrawn when
the colour mode flips). If one fails to parse, the page shows its source
instead and the browser console says why.

For the API reference:

Edit `docs/openapi.yaml`. Nothing else — the pages render whatever the spec
contains, and the sidebar and the per-operation pages are generated from it, so
a new endpoint needs no new file. Merging to `main` builds the site on the PR
but does not publish it; the next release republishes it (Actions → Release),
and `workflow_dispatch` on the Docs site workflow republishes by hand.

Validate before pushing (CI runs the same check):

```sh
npx @redocly/cli lint docs/openapi.yaml
```

Warnings are expected — `operation-4xx-response` and `tag-description` fire
across the existing spec. Keep the count from growing; don't chase it to zero.

Two rules the build enforces, both of which fail loudly:

- **No YAML anchors or merge keys** (`&x`, `<<: *x`). YAML 1.2 parsers ignore
  `<<` by default, so the merged fields silently vanish for anyone generating a
  client from the published spec — the legacy operations lost their `tags` and
  `deprecated` that way. Write operations out in full, or share with `$ref`.
- **Every operation needs a tag**, or it lands in an untitled sidebar group.

Prefer `examples: [value]` on a schema or parameter over leaving it bare: the
sample requests and responses are generated from the spec, and a property with
no example renders as the word `string`.

Preview locally, with hot reload:

```sh
just docs-preview     # http://localhost:8000/spacestate/
```

To show someone else on the tailnet:

```sh
just docs-build
npx vitepress preview docs --port 8001
tailscale serve --bg --set-path /spacestate http://localhost:8001/spacestate
tailscale serve --https=443 --set-path /spacestate off    # when you're done
```

The target path matters. `tailscale serve --set-path /spacestate` strips that
prefix before proxying, while the site is built with `base: "/spacestate/"` and
asks for its assets under it; pointing at `localhost:8001/spacestate` puts the
prefix back. Without `--set-path` on the way out, `off` tears down every mount
on the tailnet name, not just this one.

`tailscale serve` is tailnet-only. Do not reach for `tailscale funnel` here;
publishing is what Pages is for.

### Updating the theme from /pixel

`/pixel` is a VitePress site too, so its stylesheet already maps the Pixel
design tokens onto the `--vp-*` variables this site uses. `pixel.css` is a
verbatim copy of that section, because a Pages site cannot read another
origin's CSS. Regenerate it:

```sh
just pixel-theme
```

The script fails rather than writing a truncated or empty file. Commit the
result: the build must not depend on /pixel being up.

`openapi.css` is the hand-written half, and covers only what Pixel has no
opinion about — the library's components, method badges, the shadcn tokens it
inherits from its Tailwind build. If `/pixel` adds a token you want, use it
from there; don't copy its value into a second place.

Fonts come from Google Fonts (IBM Plex Sans/Mono, Pixelify Sans) rather than
`/pixel`'s self-hosted copies, which are same-origin to that site only.
Pixelify Sans is a pixel face: it is used for the site title, page titles and
tag headings, and deliberately not for the twelve operation titles on `/all`.

`just docs-preview` and check both modes — the toggle is top-right.

### Bumping vitepress-openapi

The site leans on three pieces of the library's API, and a major version can
move any of them. After bumping, check a per-operation page, `/all`, and both
colour modes:

- `useSidebar` / `usePaths` generate the nav and the per-operation routes.
- `usePlayground().setSecuritySchemeDefaultValues` sets the credential
  placeholders. Without it the samples invent credentials: an `http`/`bearer`
  scheme renders as a bare `Token`, an `apiKey` as its own parameter name.
  Never put a real key there — keys come from the Pixelbar board.
- `operation.hiddenSlots` drops the library's inline attribution, which the
  site footer carries instead.

`openapi.css` targets the library's class names and its shadcn tokens, so
restyled internals show up as unthemed boxes rather than as a build failure.

### Publishing

`.github/workflows/docs.yml` builds on every PR that touches `docs/`, and
publishes only on `workflow_dispatch`. The Release workflow owns publishing:
its `docs-build`/`docs-deploy` jobs build the site from the released commit, so
the published reference is the released API and not whatever has landed on
`main` since. Both deploys share the `pages` concurrency group, so a manual
republish and a release cannot race. Pages must be set to "GitHub Actions" as
its source — once, by an admin:

```sh
gh api -X POST repos/pixelbar/spacestate/pages -f build_type=workflow
```

The service itself does **not** serve the docs. `/docs` on
`spacestate.pixelbar.nl` is deliberately not a route: the spec is static and
Pages hosts it for free, without the API needing to ship HTML.

One consequence worth knowing: the "Try it out" button fires a real
cross-origin request from `pixelbar.nl` at `spacestate.pixelbar.nl`. The `GET`
endpoints send `Access-Control-Allow-Origin: *` and work; `POST /api/v1/state`
does not set CORS headers, so trying it from the docs page fails in the
browser. Curl and the code samples are unaffected.

## Changelog

Every PR needs a `CHANGELOG.md` entry under `[Unreleased]`, enforced by CI. Add
the `skip-changelog` label for pure chores. `just check-changelog --base
origin/main` runs the same check locally.

### Conflicts

Two PRs that both add entries conflict in `CHANGELOG.md` as soon as one merges,
and after a release every open PR does, because `[Unreleased]` is emptied.
Keeping both sides is almost always right, so that is automated:

- **On GitHub**, `.github/workflows/changelog-merge.yml` runs whenever `main`'s
  `CHANGELOG.md` changes and after each Release. For every open PR from this
  repo that edits the file, it merges `main` in; if `CHANGELOG.md` is the only
  conflict and the resolution is safe, it pushes the merge commit and comments
  on the PR. Otherwise it changes nothing and comments why. Fork PRs and PRs
  with other conflicts are left alone.
- **Locally**, in a merge or rebase that stopped on `CHANGELOG.md`, run `just
  changelog-merge`. `just changelog-merge-driver` registers it as a git merge
  driver for your clone, so git does it by itself.

"Safe" means `scripts/changelog-merge.ts` can do it without guessing: the
branch's new entries go at the end of their section (never a second heading),
an entry both sides added is kept once, one `main` has already released is
dropped, and after a release the branch's entries land in the new
`[Unreleased]`. It refuses — leaving the conflict to a person — when both sides
changed the same entry, when the branch changed an entry that has since been
released, when a side has a section twice, an unknown `###` heading or prose
that isn't a list entry, or when both sides changed the intro, the released
versions or the links.

For CI to run on those pushed merges, a maintainer sets up a GitHub App; see
"Changelog conflicts" in the README.
