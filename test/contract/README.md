# Contract tests

Automated evidence for two contracts on this service's **outputs**:

- **Legacy parity.** `/spacestate.php` and the toggle endpoints match the
  legacy PHP system's, so the cutover can't silently break a device. Route
  names and locations are allowed to move and the legacy HTML page is gone;
  the bytes those endpoints emit are not.
- **SpaceAPI schema.** Every address that serves a SpaceAPI document serves
  one that is valid against the official schema of the version it claims. See
  "SpaceAPI schema contract" below.

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
| `spaceapi-schema.contract.test.ts` | Every SpaceAPI address, against the official schema of its version |
| `spacestate.contract.test.ts` | The simple state JSON at `/spacestate.php` |
| `togglestate.contract.test.ts` | `/togglestate.php` and `/togglebaker.php` bodies and status codes |
| `legacyParity.ts` | Shared comparison helpers (not a test file) |

## SpaceAPI schema contract

The SpaceAPI document used to be pinned to the legacy PHP output as well. It
no longer is: it is served in versions 0.13, 14 and 15, and `/`, `/index.php`
and `/api/v1/spaceapi` serve the latest. The legacy document's content lives
on in the 0.13 version, minus what 0.13 never defined (top-level `open` and
`icon`, `contact.discord`), and plus `state.lastchange`.

What holds it instead is the published spec. For every address
(`/`, `/index.php`, `/api/v1/spaceapi`, `/api/v1/spaceapi/{0.13,13,14,15}`,
`/spaceapi/{13,14,15}.json`), open and closed:

| Check | Why |
| --- | --- |
| Valid against the official schema of the version it claims, as published | That is the SpaceAPI contract; the directory drops invalid endpoints. |
| Valid against the same schema in **strict** mode | The official schemas accept any key, so a field from the wrong version would pass. Strict mode rejects keys a version doesn't define, except `ext_*`. |
| Declares its version (`api: "0.13"`, or `api_compatibility: ["14"]` / `["15"]`) | One document, one version, so a consumer never gets a field its version doesn't have. |
| `state.open` matches the state, `state.lastchange` the last change | The two live fields. |
| `Content-Type: application/json; charset=utf-8`, `Access-Control-Allow-Origin: *`, `Cache-Control: no-cache` | What [the SpaceAPI](https://spaceapi.io/provide-an-endpoint/) asks of an endpoint, and what the legacy one sent. |

Unknown versions (`/api/v1/spaceapi/16`, `/spaceapi/15`) are 404s.

The schemas are vendored in `src/domain/spaceapi/schemas/`, verbatim from
[SpaceApi/schema](https://github.com/SpaceApi/schema); `versions.ts` names the
commit. The same strict validation runs when the config is loaded, so a bad
`spaceapi.yaml` is refused by `just edit spaceapi` and, on a live reload, the
last good config keeps being served. `just check-spaceapi [file]` runs it on
any file, and the **SpaceAPI schema** workflow runs it, with these tests, on
every PR that touches the config or the SpaceAPI code.

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

- `https://spacestate.pixelbar.nl/spacestate.php` → `spacestate-closed.json`

The space was closed throughout, so the open-state body is **derived, not
recorded**, and `recording.json` says so. The derivation is mechanical and
safe to check by eye against the PHP: `spacestate.php` emits the `state`
column verbatim inside `{"state":…}`, so the open body is the recorded one
with `closed` → `open`.

(The legacy SpaceAPI document was recorded too, on the same day, from
`https://spaceapi.pixelbar.nl/index.php`. Its fixtures were removed when the
document became versioned; they are in the git history.)

Nothing under `test/fixtures/legacy/` contains a credential. The toggle
endpoints were **never called**: they are write endpoints, and one request
would have changed the real space status. Their contract is read off
`SpaceStateScripts/togglestate.php` and `togglebaker.php` and pinned in
`recording.json` under `togglestate.outcomes`.

Legacy source:
[SpaceStateScripts](https://github.com/pixelbar/SpaceStateScripts)
(`spacestate.php`, `togglestate.php`, `togglebaker.php`).

## What "identical" means

Per endpoint, because the answer differs:

| Output | Standard | Why |
| --- | --- | --- |
| `/spacestate.php` | **Byte-identical** | Two keys, polled by hardware and by the old SpaceAPI script. There is nothing to trade away, so nothing is traded away. |
| Toggle bodies | **Byte-identical** | `SUCCESS` and `ALLREADY TOGGLED TO THIS STATE` are matched as strings by the devices, typo included. |
| Status codes | **Identical** | 200 on both toggle successes, 302 on every rejection. |

### Headers

| Header | Contract |
| --- | --- |
| `Access-Control-Allow-Origin: *` | Must match on `/spacestate.php`. Asserted against the recording. |
| `Cache-Control: no-cache` | Must match on `/spacestate.php`. Asserted against the recording. |
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

1. **`Content-Type` gains `; charset=utf-8`.** Fastify appends it. The media
   type is unchanged and UTF-8 is JSON's default encoding anyway.
2. **Toggle replies are `text/plain`, not `text/html; charset=UTF-8`.** The
   PHP set no `Content-Type` at all, so `SUCCESS` went out under PHP's
   `default_mimetype`. A seven-character status string is not HTML; serving it
   as HTML invites a browser to render whatever it contains.
3. **The token is checked before the already-in-this-state answer.** The PHP
   compared the requested state against the current one *first*, so any
   caller — no token needed — could read the current state off the toggle
   endpoint and get `ALLREADY TOGGLED TO THIS STATE`. This service
   authenticates first, so an unknown token gets the redirect even when the
   state already matches. A deliberate narrowing, and the only case where a
   legacy *body* was not preserved.
4. **One handler for `/togglestate.php` and `/togglebaker.php`.** The legacy
   files were near-duplicates differing only in a debug flag and in
   `togglebaker.php` not honouring `X-Forwarded-For`. Both are accidental
   drift, not behaviour, so both paths now behave identically — including the
   `X-Forwarded-For` quirk, which is preserved as the legacy
   `togglestate.php` had it (honour the header only when it differs from the
   socket address).
5. **All three parameters are required.** The PHP's guard was
   `isset($token) || isset($user) || isset($state)` — an `||` where `&&` was
   meant — and then read all three regardless, on undefined-variable notices.
   A partial request either fell through to the redirect (no token row
   matched, so `$toggler[0]->ip` was null) or hit the unauthenticated
   already-in-this-state branch covered by difference 5. Requiring all three
   up front reaches the redirect in both cases.
6. **The legacy HTML page is gone, and `/` serves the SpaceAPI document.** On
   the legacy `spacestate.pixelbar.nl`, `/` and `/index.php` were
   `SpaceStateScripts/index.php`: a one-line HTML widget reading "We're
   Open" / "We're Closed". This service serves the SpaceAPI JSON at those
   paths instead (the latest version), matching `spaceapi.pixelbar.nl/`. Per the issue, the HTML
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
  fixtures are a point-in-time recording of endpoints whose output has no
  config in it, so nothing on this side can drift under them.

## Re-recording

The space has to be in the state you want to capture — there is no way to ask
the legacy system for the other one, and you must not toggle it to get one.

```sh
cd test/fixtures/legacy
curl -sS https://spacestate.pixelbar.nl/spacestate.php -o spacestate-closed.json
```

`curl -o` writes exactly what the server sent, with no trailing newline
added. Then update `recordedAt` and the per-fixture notes in
`recording.json`, and derive the opposite state's body as described above.

**`GET` only.** `togglestate.php` and `togglebaker.php` take a device token
and change the real space status; never call them, with or without a token,
and never put a token in a fixture.
