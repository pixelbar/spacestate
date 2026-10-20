# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Until 1.0.0, releases stay on 0.x: `Added` bumps minor, `Fixed`/`Changed` (and the other Keep a Changelog types) bump patch. The major version is never bumped automatically.

## [Unreleased]

### Added

- Sentry metrics for every legacy endpoint hit (`/spacestate.php`, `/index.php`, `/`, `/togglestate.php`, `/togglebaker.php`): `legacy.hits` counter and `legacy.response_time` distribution (attributes: route, method, status only, to keep series bounded), plus a `legacy.hit` log with caller detail (socket and forwarded IPs, user agent, all request headers, query). The `token` query param and auth/cookie headers are redacted.
- OpenAPI 3.1 spec for the `/api/v1` endpoints, `/healthz` and the legacy shim in `docs/openapi.yaml`.
- The spec is published at pixelbar.nl/spacestate/ as a browsable reference (vitepress-openapi, themed to match pixelbar.nl/pixel), built by `just docs-build` and deployed to GitHub Pages. The site is generated from `openapi.yaml`, so editing the spec is the only step needed to update it.
- Cutting a release publishes the docs site to GitHub Pages from the released commit (`docs-build`/`docs-deploy` in the Release workflow), so the live reference is the released API. `.github/workflows/docs.yml` now builds on pull requests and republishes only on `workflow_dispatch`; both deploys share the `pages` concurrency group.

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


[Unreleased]: https://github.com/pixelbar/spacestate/compare/v0.4.1...HEAD
[0.4.1]: https://github.com/pixelbar/spacestate/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/pixelbar/spacestate/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/pixelbar/spacestate/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/pixelbar/spacestate/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/pixelbar/spacestate/releases/tag/v0.1.0
