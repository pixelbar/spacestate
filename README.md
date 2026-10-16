# spacestate

TypeScript rewrite of Pixelbar's SpaceAPI + space-open/closed state service
(`SpaceApiScripts` + `SpaceStateScripts`), deployed on Azure Container Apps
via Terraform.

A clean new API lives alongside an isolated, temporary `src/legacy/` shim
that keeps the old URL paths, token+IP toggle auth, and response shapes
working for hardware/consumers that haven't migrated yet (the physical
space-state button, in particular). See `src/legacy/plugin.ts` for what that
covers and why.

## API docs

The HTTP API is described by an OpenAPI 3.1 spec: [`docs/openapi.yaml`](docs/openapi.yaml)
(validate with `npx @redocly/cli lint docs/openapi.yaml`). Paste it into
https://editor.swagger.io or run `npx @redocly/cli preview-docs docs/openapi.yaml` to browse it.

## Local development

Requires Docker (for Azurite, the local Table Storage emulator) and Node 22+.

```sh
npm install
docker compose up -d azurite
just dev          # http://localhost:3000, config from config/*.sample.*
```

Or run the whole thing containerized: `docker compose up --build`.

## Tests

```sh
just test-unit         # pure domain/config logic, no I/O
docker compose up -d azurite
just test-integration  # exercises both the new API and the legacy adapter
```

## Deploying

Infra lives in `infra/` (Terraform, `azurerm` provider). The domain is on
external DNS, so the custom domain rollout is two phases:

```sh
cd infra
terraform init -backend-config=backend.azurerm.hcl
terraform apply -var="custom_domain=spacestate.pixelbar.nl" -var="container_image=ghcr.io/pixelbar/spacestate:<tag>"
# read the `domain_verification_id` and `default_fqdn` outputs, create the
# TXT + CNAME records at your DNS provider, wait for them to propagate, then:
terraform apply -var="custom_domain=spacestate.pixelbar.nl" -var="container_image=ghcr.io/pixelbar/spacestate:<tag>" -var="bind_custom_domain=true"
```

State is remote: storage account `pixelbartfstate`, container `spacestate`
(see `infra/backend.azurerm.hcl`). Initialise with
`terraform init -backend-config=backend.azurerm.hcl`; this needs `az login`
and Storage Blob Data Contributor on the container.

To migrate an existing local state, run this once from the directory holding
`terraform.tfstate`, then answer `yes` to copy it:

```sh
az storage container create --account-name pixelbartfstate --name spacestate --auth-mode login
terraform init -migrate-state -backend-config=backend.azurerm.hcl
```

The app reads its config from three blobs rather than a database, each
with a sample under `config/`:

- `spaceapi.json` — the public SpaceAPI document, exactly as served, minus
  the live fields (`open`, `state.open`), which come from current state
  (`config/spaceapi.sample.json`)
- `api-keys.yaml` — API keys for the `/api/v1` endpoints (`config/api-keys.sample.yaml`)
- `legacy.yaml` — legacy device credentials (`config/legacy.sample.yaml`)

After the first `apply`, upload real ones:

```sh
for f in spaceapi.json api-keys.yaml legacy.yaml; do
  az storage blob upload \
    --account-name <storage_account_name output> \
    --container-name config \
    --name "$f" \
    --file "./$f" \
    --auth-mode login
done
```

To change a live config safely (pull, edit, validate, review diff, confirm, push):

```sh
cp .env.example .env   # then set SPACESTATE_STORAGE_ACCOUNT (just loads .env automatically)
just edit spaceapi   # or api-keys | legacy: edit remote in $EDITOR, diff, confirm, push
just pull            # diff remote vs config/prod/ (gitignored), confirm overwriting local
just push            # diff remote vs config/prod/, confirm overwriting remote (add a name for one file)
```

To add an API key: `just api-key <id> --role read|write --add` appends a freshly
generated key to `config/prod/api-keys.yaml`, then `just push api-keys`.

Locally, override the sources with `SPACEAPI_CONFIG_SOURCE`,
`API_KEYS_CONFIG_SOURCE` and `LEGACY_CONFIG_SOURCE` (`file://` or `blob://`).

Editing those blobs later takes effect on the next cold start (or within a
few minutes if a replica is already running — see `src/config/loader.ts`),
no redeploy needed.

## Observability

Set `SENTRY_DSN` (and optionally `SENTRY_ENVIRONMENT`) to enable Sentry
error tracking, tracing, and logs — see `src/observability/sentry.ts`. The
app runs fine with it unset; Sentry calls become no-ops.

In production the DSN comes from Terraform: pass `-var="sentry_dsn=..."` (or
set it in a gitignored `*.auto.tfvars`) on `apply`. Without it the Container
App has no `SENTRY_DSN` and **nothing is reported**.

What is reported: 5xx errors (with route/method), config reload and
state-service failures, startup crashes, and every `request.log`/`app.log`
line (as Sentry Logs, via `pinoIntegration`), including state changes and
rejected writes.

## CI/CD

`.github/workflows/ci.yml` typechecks, builds, runs unit + integration tests
(against Azurite), builds the Docker image, and on PRs requires a
`CHANGELOG.md` entry under `## [Unreleased]` (label a PR `skip-changelog`
for pure chores).

Releases are cut from `main` via Actions → Release → Run workflow. It turns
`[Unreleased]` into a dated version (`Added` → minor, anything else → patch,
never 1.0 automatically), bumps `package.json`/`package-lock.json`, commits
`Release vX.Y.Z`, tags it, opens a GitHub Release, and pushes
`ghcr.io/pixelbar/spacestate:{vX.Y.Z,<sha>,latest}`. A final `deploy` job
then waits for approval of the GitHub Environment `prod`, rolls the Container
App to the `<sha>` image with `az containerapp update`, and waits for
`/healthz`. Terraform ignores the image (`lifecycle.ignore_changes`), so
`terraform apply` never rolls prod back; it only manages infrastructure.
The bot pushes to `main`, so if branch protection is on, allow
`github-actions[bot]` to bypass it.

### One-time deploy setup

```sh
SUB=$(az account show --query id -o tsv)
TENANT=$(az account show --query tenantId -o tsv)

# Identity GitHub logs in as (no client secret; OIDC only)
APP_ID=$(az ad app create --display-name spacestate-github-deploy --query appId -o tsv)
az ad sp create --id "$APP_ID"
az ad app federated-credential create --id "$APP_ID" --parameters '{
  "name": "github-prod",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:pixelbar/spacestate:environment:prod",
  "audiences": ["api://AzureADTokenExchange"]
}'

# Allowed to update the app, scoped to its resource group only
az role assignment create --assignee "$APP_ID" --role Contributor \
  --scope "/subscriptions/$SUB/resourceGroups/pixelbar-spacestate"

# GitHub: repo variables + the approval-gated environment
gh variable set AZURE_CLIENT_ID --body "$APP_ID"
gh variable set AZURE_TENANT_ID --body "$TENANT"
gh variable set AZURE_SUBSCRIPTION_ID --body "$SUB"
```

Then in GitHub → Settings → Environments, create `prod` and add required
reviewers.

After the first release publishes the image, make the GHCR package public once
(Packages → spacestate → Package settings → Change visibility). GitHub has no
API for this; Azure pulls anonymously, and the release fails before deploying
if the package is still private.
