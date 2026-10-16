# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Until 1.0.0, releases stay on 0.x: `Added` bumps minor, `Fixed`/`Changed` (and the other Keep a Changelog types) bump patch. The major version is never bumped automatically.

## [Unreleased]

### Added

- CI (typecheck, build, unit and integration tests against Azurite, Docker build) and a manually triggered Release workflow that cuts this changelog into a version, bumps `package.json`, tags, publishes the image to GHCR, opens a GitHub Release and, after `prod` environment approval, deploys the image to the Azure Container App and checks `/healthz`. Terraform now ignores the Container App's image so `terraform apply` can't roll back a released version.
- Sentry continuous profiling via `@sentry/profiling-node`, configured in `src/observability/sentry.ts` and controlled by `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE` and `SENTRY_PROFILE_SESSION_SAMPLE_RATE`. A no-op when `SENTRY_DSN` is unset.
