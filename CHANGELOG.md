# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Until 1.0.0, releases stay on 0.x: `Added` bumps minor, `Fixed`/`Changed` (and the other Keep a Changelog types) bump patch. The major version is never bumped automatically.

## [Unreleased]

### Added

- State changes are announced through a generic notification system (`src/notifications/`). Every recorded change, from `/api/v1` or the legacy endpoints, is handed to each subscriber without delaying the response: each attempt times out (10 s by default), failures are retried after 1 s, 5 s and 30 s unless the subscriber says retrying cannot help, and deliveries to one subscriber stay in order. Outcomes are logged to Sentry. Channel types plug in through a registry, and the operator lists channels in `notifications.yaml`, a new optional config blob (`NOTIFICATIONS_CONFIG_SOURCE`, `just edit notifications`) with per-channel message templates (`{space}`, `{state}`, `{time}`, …). Without that blob the app runs as before and announces nothing; Terraform adds the env var, and an upload takes effect within five minutes. README: "Notifications".

### Fixed

- A `terraform apply` that adds or removes more than one domain no longer races on the Container App. Each hostname write rewrites the app's whole domain list, and the parallel writes (the provider's deletes and the `az` binds take no lock) could drop a domain or fail with `ContainerAppOperationInProgress`. Every hostname write now goes through `infra/hostname.sh`, which holds an exclusive `flock` (taken through `perl`, since macOS has no `flock(1)`) that the kernel releases when the process dies, so a killed apply leaves no stale lock. A failed hostname lookup fails the script instead of reading as "not attached". Hostnames are attached by that script instead of `azurerm_container_app_custom_domain`; a `removed` block stops managing the old resources without touching the live hostnames.

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
