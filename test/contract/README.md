# Legacy parity contract tests

Automated evidence that this service's **outputs** match the legacy PHP
system's, so the cutover can't silently break a consumer. Route names and
locations are allowed to move and the legacy HTML page is gone; the bytes the
read endpoints emit are not.

```sh
just test-contract      # no Azurite needed
```

The tests live here rather than in `test/integration/` on purpose: they use
in-memory stores (`test/helpers/buildContractApp.ts`), so they run in the
normal CI `check` job without the Table Storage emulator. Everything that
shapes a response — the route handlers, `config/*.sample.*` parsing, the
SpaceAPI builder, Fastify's serializer — is the production code path.

| File | Covers |
| --- | --- |
| `spaceapi.contract.test.ts` | The SpaceAPI document at `/`, `/index.php`, `/api/v1/spaceapi` |
| `spacestate.contract.test.ts` | The simple state JSON at `/spacestate.php` |
| `togglestate.contract.test.ts` | `/togglestate.php` and `/togglebaker.php` bodies and status codes |
| `legacyParity.ts` | Shared comparison helpers (not a test file) |

## The golden fixtures

`test/fixtures/legacy/` holds the recording, with
`test/fixtures/legacy/recording.json` as its index: the URL, status and
response headers per endpoint, which body file goes with which state, and a
note on how each body was obtained. `test/helpers/legacyFixtures.ts` loads it.

Bodies are stored **byte-exact, with no trailing newline** — PHP's `echo`
emitted none, and `/spacestate.php` is compared byte-for-byte, so an editor
that "helpfully" adds one will fail the suite. That is the intended alarm, not
a bug: re-record rather than reformat.

Recorded `GET`-only from the live legacy hosts on 2026-10-20:

- `https://spaceapi.pixelbar.nl/index.php` → `spaceapi-closed.json`
- `https://spacestate.pixelbar.nl/spacestate.php` → `spacestate-closed.json`

The space was closed throughout, so the open-state bodies are **derived, not
recorded**, and `recording.json` says so per fixture. The derivation is
mechanical and safe to check by eye against the PHP: `spacestate.php` emits
the `state` column verbatim inside `{"state":…}`, and
`SpaceApiScripts/index.php` builds a document of hard-coded values whose only
dynamic input is that same state, assigned to both `open` and `state.open`.
So the open bodies are the recorded ones with `"open":false` → `"open":true`
(twice) and `closed` → `open`, and the tests assert the two flags move
together.

Nothing under `test/fixtures/legacy/` contains a credential. The toggle
endpoints were **never called**: they are write endpoints, and one request
would have changed the real space status. Their contract is read off
`SpaceStateScripts/togglestate.php` and `togglebaker.php` and pinned in
`recording.json` under `togglestate.outcomes`.

Legacy sources: [SpaceApiScripts](https://github.com/pixelbar/SpaceApiScripts)
(`index.php`) and
[SpaceStateScripts](https://github.com/pixelbar/SpaceStateScripts)
(`spacestate.php`, `togglestate.php`, `togglebaker.php`).

## What "identical" means

Per endpoint, because the answer differs:

| Output | Standard | Why |
| --- | --- | --- |
| `/spacestate.php` | **Byte-identical** | Two keys, polled by hardware and by the old SpaceAPI script. There is nothing to trade away, so nothing is traded away. |
| SpaceAPI document | **JSON-semantic** (`toEqual` on the parsed document) | Two byte differences are accepted, both listed below. Every consumer parses this document; none of them read it as text. |
| Toggle bodies | **Byte-identical** | `SUCCESS` and `ALLREADY TOGGLED TO THIS STATE` are matched as strings by the devices, typo included. |
| Status codes | **Identical** | 200 on both toggle successes, 302 on every rejection. |

"JSON-semantic" is still pinned tightly. Alongside the `toEqual`, each state
asserts that re-serialising both documents with their keys sorted, after
undoing PHP's `\/` escaping, gives **identical bytes**. So the two accepted
differences are the *only* ones: a renamed field, a reformatted float, a
changed string or a stray key fails the test.

### Headers

| Header | Contract |
| --- | --- |
| `Access-Control-Allow-Origin: *` | Must match, on both read endpoints. Asserted against the recording. |
| `Cache-Control: no-cache` | Must match, on both read endpoints. Asserted against the recording. |
| `Content-Type` | The **media type** must match (`application/json`); the `; charset=utf-8` parameter is an accepted addition. |
| `Location` | Must be exactly `https://www.pixelbar.nl/` on every toggle rejection. |

The toggle endpoints set no CORS and no caching header in the legacy PHP, and
the tests assert this service sets none either — a reply that started sending
`Access-Control-Allow-Origin: *` there would widen what a browser can do with
a device token.

The live legacy host also returns `server`, `x-frame-options`,
`content-security-policy`, `x-content-type-options`, `referrer-policy`,
`x-xss-protection` and a stray `host` response header. Those are the old
Apache's, not the endpoint's contract, and are deliberately left out of the
recording.

## Intentional differences

Each entry here is asserted in the tests, so this list cannot quietly go
stale: if a difference disappears, its assertion fails and this file is what
needs editing.

1. **Key order in the SpaceAPI document: `open` comes last.** The legacy PHP
   built the array literally and put `open` between `spacefed` and `icon`;
   the builder spreads the static config and appends the live flag, which
   lands it at the end. `state.icon` before `state.open` happens to match.
   JSON objects are unordered, so no conforming consumer can notice.
2. **`/` is not escaped as `\/`.** `json_encode()` without
   `JSON_UNESCAPED_SLASHES` wrote `https:\/\/pixelbar.nl`;
   `JSON.stringify` writes `https://pixelbar.nl`. Both decode to the same
   string. Affects the SpaceAPI document only — `/spacestate.php` has no
   slashes in it, which is why that one can be byte-identical.
3. **`Content-Type` gains `; charset=utf-8`.** Fastify appends it. The media
   type is unchanged and UTF-8 is JSON's default encoding anyway.
4. **Toggle replies are `text/plain`, not `text/html; charset=UTF-8`.** The
   PHP set no `Content-Type` at all, so `SUCCESS` went out under PHP's
   `default_mimetype`. A seven-character status string is not HTML; serving it
   as HTML invites a browser to render whatever it contains.
5. **The token is checked before the already-in-this-state answer.** The PHP
   compared the requested state against the current one *first*, so any
   caller — no token needed — could read the current state off the toggle
   endpoint and get `ALLREADY TOGGLED TO THIS STATE`. This service
   authenticates first, so an unknown token gets the redirect even when the
   state already matches. A deliberate narrowing, and the only case where a
   legacy *body* was not preserved.
6. **One handler for `/togglestate.php` and `/togglebaker.php`.** The legacy
   files were near-duplicates differing only in a debug flag and in
   `togglebaker.php` not honouring `X-Forwarded-For`. Both are accidental
   drift, not behaviour, so both paths now behave identically — including the
   `X-Forwarded-For` quirk, which is preserved as the legacy
   `togglestate.php` had it (honour the header only when it differs from the
   socket address).
7. **All three parameters are required.** The PHP's guard was
   `isset($token) || isset($user) || isset($state)` — an `||` where `&&` was
   meant — and then read all three regardless, on undefined-variable notices.
   A partial request either fell through to the redirect (no token row
   matched, so `$toggler[0]->ip` was null) or hit the unauthenticated
   already-in-this-state branch covered by difference 5. Requiring all three
   up front reaches the redirect in both cases.
8. **The legacy HTML page is gone, and `/` serves the SpaceAPI document.** On
   the legacy `spacestate.pixelbar.nl`, `/` and `/index.php` were
   `SpaceStateScripts/index.php`: a one-line HTML widget reading "We're
   Open" / "We're Closed". This service serves the SpaceAPI JSON at those
   paths instead, matching `spaceapi.pixelbar.nl/`. Per the issue, the HTML
   page isn't needed — but anything that embeds that widget in an `<iframe>`
   will get JSON after the DNS cutover.

## Not covered

- **`/state/`** on the legacy host — `SpaceStateScripts/state/index.php` is a
  copy of `spacestate.php` and is live today, serving the same 18 bytes. This
  service does not route it, so a consumer polling `/state/` would get a 404
  after the cutover. Adding the route is a one-liner but a behaviour change,
  so it is left as a follow-up rather than smuggled in with the tests.
- **`jitsistate.php`, `doorbell.php`, `slackbot.php`, `override/`** — out of
  the rewrite's scope, not part of this contract.
- **A live legacy-vs-new comparison** is not scheduled; see the issue. The
  fixtures are a point-in-time recording, and the only thing that can drift
  under them is the static config (`config/spaceapi.sample.json` and the
  production blob). Re-record and re-run after editing either.

## Re-recording

The space has to be in the state you want to capture — there is no way to ask
the legacy system for the other one, and you must not toggle it to get one.

```sh
cd test/fixtures/legacy
curl -sS https://spaceapi.pixelbar.nl/index.php      -o spaceapi-closed.json
curl -sS https://spacestate.pixelbar.nl/spacestate.php -o spacestate-closed.json
```

`curl -o` writes exactly what the server sent, with no trailing newline
added. Then update `recordedAt` and the per-fixture notes in
`recording.json`, and derive the opposite state's bodies as described above.

**`GET` only.** `togglestate.php` and `togglebaker.php` take a device token
and change the real space status; never call them, with or without a token,
and never put a token in a fixture.
