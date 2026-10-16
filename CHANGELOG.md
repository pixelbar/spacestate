# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Until 1.0.0, releases stay on 0.x: `Added` bumps minor, `Fixed`/`Changed` (and the other Keep a Changelog types) bump patch. The major version is never bumped automatically.

## [Unreleased]

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


[Unreleased]: https://github.com/pixelbar/spacestate/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/pixelbar/spacestate/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/pixelbar/spacestate/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/pixelbar/spacestate/releases/tag/v0.1.0
