# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Until 1.0.0, releases stay on 0.x: `Added` bumps minor, `Fixed`/`Changed` (and the other Keep a Changelog types) bump patch. The major version is never bumped automatically.

## [Unreleased]

### Added

- Legacy parity contract tests (`just test-contract`, `test/contract/`): the SpaceAPI document, `/spacestate.php` and the toggle replies are compared against golden fixtures recorded `GET`-only from the live PHP system (`test/fixtures/legacy/`, indexed by `recording.json`). `/spacestate.php` and the toggle bodies must be byte-identical; the SpaceAPI document must be JSON-identical, pinned so that key order and PHP's `\/` escaping are the only byte differences possible. CORS, `Cache-Control` and the `Content-Type` media type are asserted from the recording. Every intentional difference is listed in `test/contract/README.md` and asserted, so the list can't go stale. The tests use in-memory stores, so they need no Azurite and run in the CI `check` job.
- A dev environment for trying a pull request on Azure before it merges (README: "Dev environment"). Actions → Deploy dev (or `just deploy-dev <PR|branch|SHA>`) runs that commit's checks, publishes `ghcr.io/pixelbar/spacestate:<sha>` and `:dev`, applies that commit's Terraform to dev, rolls dev's Container App and waits for `/healthz`. It runs only by hand, and refuses forks and branches from before dev existed. Dev is the same Terraform root with `environment = "dev"`: its own resource group (`pixelbar-spacestate-dev`), storage, Container App and state (`infra/backend.dev.azurerm.hcl`, in its own container), and no custom domains. Its CI identity can reach only those, so a deploy cannot touch prod. `just tf-dev` runs Terraform on dev; `just pull|push|edit --env dev` manage dev's config blobs through `config/dev/`. Actions → Destroy dev (`just destroy-dev`) takes dev's app, Container Apps environment and Log Analytics workspace down between stretches of feature work. It keeps the resource group and storage, so config and history survive, and the next Deploy dev brings dev back with no setup. Prod's names and plan are unchanged, apart from a new `terraform_data.environment`. Once applied, it makes a plan that pairs one environment's variables with the other's state fail instead of replacing every resource. The provider no longer registers resource providers (`resource_provider_registrations = "none"`); prod already has the ones this stack uses.

### Changed

- Sentry no longer gets a log line for every poll. A week of production logs was over 95% `incoming request`, `request completed`, `StateService.getCurrentState: served from pointer` and `legacy.hit`, all from the same few clients polling the state. At the default `LOG_LEVEL=info`, Sentry Logs (and stdout) now carry what happened: state changes with who made them, rejections, errors, config reload failures, the state pointer falling back to history (once, not on every read), and `legacy.caller`, logged the first time a replica sees a legacy caller (route, client IP, user agent), which keeps the list of devices still on the legacy endpoints readable. `LOG_LEVEL=debug` (Terraform: `log_level`) brings back the line per request, per 404, per state read and per legacy hit; `trace` also brings back `incoming request`. The level applies to pino and to direct `Sentry.logger` calls alike. The `legacy.hits`/`legacy.response_time` metrics still count every legacy request (README: "Observability").
- Traces follow the same split. Every state change (`/togglestate.php`, `/togglebaker.php`, `POST /api/v1/state`) and history read is traced (`SENTRY_TRACES_SAMPLE_RATE`, now default `1.0`). Polls, 404s and background config reloads are sampled at `SENTRY_ROUTINE_TRACES_SAMPLE_RATE` (default `0.01`), instead of everything at 10%. A poll's sampling no longer follows an incoming trace header.
- Each event is logged once. A legacy toggle used to write `request.log`, `Sentry.logger` and `StateService` lines for the same outcome; now it writes one `legacy.togglestate …` line (the message names are unchanged), and `legacy.auth failed` is folded into `legacy.togglestate rejected: unknown token or IP`, which now carries `client_ip`. `StateService.changeState: …` and `StateService.* failed` are gone: the route logs the change, and the error handler logs and captures the failure. 4xx errors raised by Fastify (bad JSON, unsupported content type) log as `request rejected` at info instead of `request failed` at error, and `request failed` now carries the route and method.

### Fixed

- A `terraform apply` that adds or removes more than one domain no longer races on the Container App. Each hostname write rewrites the app's whole domain list, and the parallel writes (the provider's deletes and the `az` binds take no lock) could drop a domain or fail with `ContainerAppOperationInProgress`. Every hostname write now goes through `infra/hostname.sh`, which holds an exclusive `flock` (taken through `perl`, since macOS has no `flock(1)`) that the kernel releases when the process dies, so a killed apply leaves no stale lock. A failed hostname lookup fails the script instead of reading as "not attached". Hostnames are attached by that script instead of `azurerm_container_app_custom_domain`; a `removed` block stops managing the old resources without touching the live hostnames.

### Security

- URL redaction also covers percent-encoded credential names, absolute and encoded legacy paths, Sentry query pairs, and error logs. Credentials nested in non-secret parameter values are detected without quadratic matching on long strings. Nested attributes are redacted at the depth limit. Sentry initialization preserves the startup enabled flag and blank-DSN handling.
- Credentials in a request URL no longer reach the logs. The legacy device token is passed as a `token` query parameter, and Fastify's default request log wrote the URL verbatim while its default 404 echoed it back ("Route POST:/togglestate.php?…&token=… not found"), so a token ended up in stdout and in Sentry Logs. The pino `req` serializer now redacts URLs — the whole query string on the legacy routes, credential-carrying parameters (`token`, `access_token`, `api_key`, `secret`, `password`, …) everywhere else — unknown paths answer a generic `404 {"error":"not_found"}` that says nothing about the request, and the error handler redacts the URL it tags Sentry events with. Sentry's own collection is scrubbed too, via `beforeSend`, `beforeSendTransaction`, `beforeSendSpan`, `beforeBreadcrumb` and `beforeSendLog`: request URLs and query strings, span names and `http.url`/`url.full`/`url.query` attributes, breadcrumbs, tags, extra and forwarded pino logs. All of it goes through one helper, `src/observability/redact.ts`. Exposed tokens still have to be rotated by hand (issue #14).

## [0.5.1] - 2026-10-28

### Fixed

- History queries read at most 12 monthly partitions per page, including empty ones, and resume through a continuation token. Wide date ranges no longer allocate every month or trigger unbounded storage work; unsafe cursors and reversed ranges return 400.
- `terraform apply` failed on a domain that was never bound before: Azure refuses to issue a managed certificate (`RequireCustomHostnameInEnvironment`) until the hostname is attached to an app, while the hostname binding depended on the certificate. The apply now attaches the hostname without a certificate, issues the managed certificate, then binds it with `az containerapp hostname bind` (`azurerm_container_app_custom_domain` cannot take a certificate created after it), and ignores later changes to the binding fields so the next plan does not revert it. This fix (#15) was applied to production but merged into a branch that had already landed, so it never reached `main` until now.

### Changed

- A `terraform apply` that forgets the Sentry DSN now fails instead of silently deploying with error reporting off: `sentry_dsn` is validated against the new `sentry_enabled` variable (default `true`), so an empty DSN stops the plan with a message naming the variable. Running without Sentry stays possible but has to be deliberate — `-var="sentry_enabled=false"`, which drops the `sentry-dsn` secret and the `SENTRY_DSN` env var. A `sentry_enabled` output says which way the stack stands, and `*.tfvars` is now gitignored so `infra/sentry.auto.tfvars` can hold the DSN for every apply (README: "Observability").
- The Container App can serve more than one custom domain. `custom_domain` (a string) and the `bind_custom_domain` switch are replaced by `custom_domains`, a set of hostnames that each get a managed certificate and binding; a domain goes in once its CNAME and `asuid` TXT records have propagated (README: "Deploying"). Taking a domain out deletes its hostname from the app before its certificate, which Azure would otherwise refuse to delete while still bound (`CertificateInUse`).
- The deployment is now production on `spacestate.pixelbar.nl` and `spaceapi.pixelbar.nl`, the default of `custom_domains`. The next apply binds them and removes the `spacestate-dev.pixelbar.nl` hostname and certificate, so point both at the Container App first.
- The app says at startup whether it reports to Sentry: `initSentry()` returns that, the `spacestate started` log carries `sentryEnabled`, and a start without a DSN also logs a `Sentry is disabled` warning. A blank `SENTRY_DSN` counts as unset. The DSN itself is never logged.

## [0.5.0] - 2026-10-20

### Added

- Sentry metrics for every legacy endpoint hit (`/spacestate.php`, `/index.php`, `/`, `/togglestate.php`, `/togglebaker.php`): `legacy.hits` counter and `legacy.response_time` distribution (attributes: route, method, status only, to keep series bounded), plus a `legacy.hit` log with caller detail (socket and forwarded IPs, user agent, all request headers, query). The `token` query param and auth/cookie headers are redacted.
- OpenAPI 3.1 spec for the `/api/v1` endpoints, `/healthz` and the legacy shim in `docs/openapi.yaml`.
- The spec is published at pixelbar.nl/spacestate/ as a browsable reference (vitepress-openapi, themed to match pixelbar.nl/pixel), built by `just docs-build` and deployed to GitHub Pages. The site is generated from `openapi.yaml`, so editing the spec is the only step needed to update it.
- Cutting a release publishes the docs site to GitHub Pages from the released commit (`docs-build`/`docs-deploy` in the Release workflow), so the live reference is the released API. `.github/workflows/docs.yml` now builds on pull requests and republishes only on `workflow_dispatch`; both deploys share the `pages` concurrency group.
- CHANGELOG conflicts resolve themselves when that is safe. When `main`'s `CHANGELOG.md` changes (and after each Release), `.github/workflows/changelog-merge.yml` merges `main` into every open PR from this repo that edits it. If `CHANGELOG.md` is the only conflict, it keeps both sides' `[Unreleased]` entries, pushes the merge and comments on the PR; it never adds a section twice, puts entries into the new `[Unreleased]` after a release, and comments with the reason instead when both sides changed the same entry or the file isn't plain Keep a Changelog. Locally, `just changelog-merge` does the same in a stopped merge or rebase, and `just changelog-merge-driver` makes git do it by itself. For CI to run on those merges, a maintainer sets up a GitHub App (README: "Changelog conflicts").

### Changed

- `just bump` also rewrites `info.version` in `docs/openapi.yaml`, so the published reference carries the released version instead of the last hand-edited one.

## [0.4.1] - 2026-10-16

### Fixed

- Exceptions on the legacy toggle path are captured in Sentry once, by the shared error handler, with route and method. The state service and legacy handler only log them: Sentry dedupes the same error object, so capturing in every layer dropped the outer context (this supersedes the "exception capture" wording in 0.4.0).

## [0.4.0] - 2026-10-16

### Added

- `/togglestate.php` and `/togglebaker.php` accept POST as well as GET (previously 404). As in the legacy PHP (`$_GET`), parameters are read from the query string only and the body is ignored.
- Sentry logs and exception capture on the success and failure paths of the legacy toggle handler, legacy auth, and `StateService.getCurrentState`/`changeState`.
- Logs are stored in Sentry: `pinoIntegration` forwards Fastify's request/app logs to Sentry Logs. State changes, rejected writes (API and legacy) and startup are logged, and Sentry is flushed on shutdown.
- 5xx errors are now reported to Sentry explicitly from the error handler, with route and method. Startup failures are reported before the process exits.
### Fixed

- Table Storage clients in production used a URL that included the table name, so every state read/write failed with 501 NotImplemented.
- `just push`/`pull`/`edit` handle a config blob that does not exist on the remote yet.

## [0.3.0] - 2026-10-16

### Added

- `just api-key <id> [--role read|write] [--add]` generates an API key and its api-keys.yaml entry.
- `just pull`, `just push` and `just edit <file>` sync the live config blobs with `config/prod/`, always showing a diff and asking before overwriting. A `justfile` now wraps the build, test and release commands, and CI uses it.

### Changed

- Terraform state moves to the `azurerm` backend (`pixelbartfstate/spacestate`); see README for the one-time migration.
- Split config into three sources: a SpaceAPI JSON document matching the public one exactly, API keys, and legacy devices. `CONFIG_SOURCE` is replaced by `SPACEAPI_CONFIG_SOURCE`, `API_KEYS_CONFIG_SOURCE` and `LEGACY_CONFIG_SOURCE`.
- SpaceAPI output no longer includes `state.lastchange`, matching the existing public document.

## [0.2.0] - 2026-10-16

### Added

- CI (typecheck, build, unit and integration tests against Azurite, Docker build) and a manually triggered Release workflow that cuts this changelog into a version, bumps `package.json`, tags, publishes the image to GHCR, opens a GitHub Release and, after `prod` environment approval, deploys the image to the Azure Container App and checks `/healthz`. Terraform now ignores the Container App's image so `terraform apply` can't roll back a released version.
- Sentry continuous profiling via `@sentry/profiling-node`, configured in `src/observability/sentry.ts` and controlled by `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE` and `SENTRY_PROFILE_SESSION_SAMPLE_RATE`. A no-op when `SENTRY_DSN` is unset.


[Unreleased]: https://github.com/pixelbar/spacestate/compare/v0.5.1...HEAD
[0.5.1]: https://github.com/pixelbar/spacestate/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/pixelbar/spacestate/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/pixelbar/spacestate/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/pixelbar/spacestate/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/pixelbar/spacestate/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/pixelbar/spacestate/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/pixelbar/spacestate/releases/tag/v0.1.0
