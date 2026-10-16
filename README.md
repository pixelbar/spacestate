# spacestate

TypeScript rewrite of Pixelbar's SpaceAPI + space-open/closed state service
(`SpaceApiScripts` + `SpaceStateScripts`), deployed on Azure Container Apps
via Terraform.

A clean new API lives alongside an isolated, temporary `src/legacy/` shim
that keeps the old URL paths, token+IP toggle auth, and response shapes
working for hardware/consumers that haven't migrated yet (the physical
space-state button, in particular). See `src/legacy/plugin.ts` for what that
covers and why.

## Local development

Requires Docker (for Azurite, the local Table Storage emulator) and Node 22+.

```sh
npm install
docker compose up -d azurite
npm run dev          # http://localhost:3000, config from config/space.sample.yaml
```

Or run the whole thing containerized: `docker compose up --build`.

## Tests

```sh
npm run test:unit         # pure domain/config logic, no I/O
docker compose up -d azurite
npm run test:integration  # exercises both the new API and the legacy adapter
```

## Deploying

Infra lives in `infra/` (Terraform, `azurerm` provider). The domain is on
external DNS, so the custom domain rollout is two phases:

```sh
cd infra
terraform init
terraform apply -var="custom_domain=spacestate.pixelbar.nl" -var="container_image=ghcr.io/pixelbar/spacestate:<tag>"
# read the `domain_verification_id` and `default_fqdn` outputs, create the
# TXT + CNAME records at your DNS provider, wait for them to propagate, then:
terraform apply -var="custom_domain=spacestate.pixelbar.nl" -var="container_image=ghcr.io/pixelbar/spacestate:<tag>" -var="bind_custom_domain=true"
```

State is local (`terraform.tfstate`) for now — move to a remote backend
(e.g. a blob container in the storage account this config creates) once
more than one person needs to run `apply`.

The app reads its config (space metadata, API keys, legacy device
credentials) from a YAML blob rather than a database — see
`config/space.sample.yaml` for the shape. After the first `apply`, upload
a real one:

```sh
az storage blob upload \
  --account-name <storage_account_name output> \
  --container-name config \
  --name space.yaml \
  --file ./space.yaml \
  --auth-mode login
```

Editing that blob later takes effect on the next cold start (or within a
few minutes if a replica is already running — see `src/config/loader.ts`),
no redeploy needed.

## Observability

Set `SENTRY_DSN` (and optionally `SENTRY_ENVIRONMENT`) to enable Sentry
error tracking, tracing, and logs — see `src/observability/sentry.ts`. The
app runs fine with it unset; Sentry calls become no-ops.

## CI/CD

`.github/workflows/ci.yml` typechecks, builds, runs unit + integration tests
(against Azurite), builds the Docker image, and on PRs requires a
`CHANGELOG.md` entry under `## [Unreleased]` (label a PR `skip-changelog`
for pure chores).

Releases are cut from `main` via Actions → Release → Run workflow. It turns
`[Unreleased]` into a dated version (`Added` → minor, anything else → patch,
never 1.0 automatically), bumps `package.json`/`package-lock.json`, commits
`Release vX.Y.Z`, tags it, opens a GitHub Release, and pushes
`ghcr.io/pixelbar/spacestate:{vX.Y.Z,<sha>,latest}`. Deploy by running
`terraform apply` with that image tag (see above). The bot pushes to `main`,
so if branch protection is on, allow `github-actions[bot]` to bypass it.
