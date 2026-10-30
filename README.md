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
(validate with `npx @redocly/cli lint docs/openapi.yaml`).

It is published as a browsable reference at **<https://pixelbar.nl/spacestate/>**
([vitepress-openapi](https://github.com/enzonotario/vitepress-openapi), themed
to match [pixelbar.nl/pixel](https://pixelbar.nl/pixel)), with the raw spec
alongside it at <https://pixelbar.nl/spacestate/openapi.yaml>.

Editing `docs/openapi.yaml` is the whole update: the pages, the sidebar and a
page per operation are all generated from it. Cutting a release republishes the
site from the released commit, so the live reference is the released API;
`.github/workflows/docs.yml` builds it on every PR that touches it, and can
republish by hand (Actions → Docs site → Run workflow).

```sh
just docs-preview   # hot-reloading preview on http://localhost:8000/spacestate/
just docs-build     # build only, into docs/.vitepress/dist/
```

See [`AGENTS.md`](AGENTS.md) for refreshing the theme from `/pixel`, previewing
over Tailscale, and the two spec rules the build enforces.

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
just test-contract     # outputs vs the recorded legacy fixtures, no I/O
docker compose up -d azurite
just test-integration  # exercises both the new API and the legacy adapter
```

`just test-contract` is the evidence that the cutover is safe: it compares
this service's SpaceAPI document, `/spacestate.php` body and toggle replies
against golden fixtures recorded from the live PHP system, and
`test/contract/README.md` lists every difference that is there on purpose.

## Deploying

Infra lives in `infra/` (Terraform, `azurerm` provider). The app serves
`spacestate.pixelbar.nl` and `spaceapi.pixelbar.nl`, the default of
`custom_domains`. Everything in this section is prod; the same root also
describes a separate dev environment (see "Dev environment").

```sh
cd infra
terraform init -backend-config=backend.azurerm.hcl
# Once, so every apply from this clone keeps Sentry wired (see "Observability"):
echo 'sentry_dsn = "https://<key>@<org>.ingest.de.sentry.io/<project>"' > sentry.auto.tfvars
terraform apply -var="container_image=ghcr.io/pixelbar/spacestate:<tag>"
```

Domains are on external DNS (TransIP), so adding one is two phases: create
its records, then add it to `custom_domains`. To add a domain, create these at its DNS provider (the values are the same for
every domain, from `terraform output`):

| Type | Name | Value |
| --- | --- | --- |
| `CNAME` | `<host>` | `default_fqdn` |
| `TXT` | `asuid.<host>` | `domain_verification_id` |

Wait for them to propagate, add the host to `custom_domains`, and apply: that
issues its managed certificate and binds it. A bare apex can't take a CNAME;
point an `A` record at `environment_static_ip` instead, but the certificate is
validated by CNAME, so an apex has not been tried.

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
app runs fine with it unset; Sentry calls become no-ops. Startup says which
it is: the `spacestate started` log carries `sentryEnabled: true|false`, and
a run without a DSN also logs a `Sentry is disabled` warning (visible in
Container Apps logs / Log Analytics — it cannot reach Sentry itself).

In production the DSN comes from Terraform, and **an apply without it fails**
rather than quietly deploying with reporting off:

```sh
# infra/sentry.auto.tfvars (gitignored) — picked up by every apply:
sentry_dsn = "https://<key>@<org>.ingest.de.sentry.io/<project>"
```

Equivalently, pass `-var="sentry_dsn=..."` per apply. If `sentry_dsn` is empty,
`terraform plan`/`apply` stops with a validation error naming the variable. To
deploy without error reporting on purpose, say so explicitly with
`-var="sentry_enabled=false"`; the DSN is then ignored (no `sentry-dsn` secret,
no `SENTRY_DSN` on the container) and the `sentry_enabled` output reads `false`.

There is no Key Vault in this stack, and `just pull`/`push`/`edit` only move the
three config blobs (`spaceapi.json`, `api-keys.yaml`, `legacy.yaml`), so
Terraform is the one place the DSN lives. Rotating it is an `apply`.

What is reported: 5xx errors (with route/method), config reload and
state-pointer failures, and startup crashes, as Issues; and every
`request.log`/`app.log` line at or above `LOG_LEVEL`, as Sentry Logs (via
`pinoIntegration`). What counts as noise is decided in one place,
`src/observability/policy.ts`.

Most traffic is polling (`/`, `/spacestate.php`, `/api/v1/state`, ...) and
scanners, so there are two levels of detail, picked with `LOG_LEVEL` (the
Terraform variable `log_level`):

| `LOG_LEVEL` | Logged (stdout and Sentry Logs) |
| --- | --- |
| `info` (default) | State changes and who made them, rejected writes, 4xx errors raised by Fastify, 5xx errors, config reload failures, the state pointer falling back to history, startup/shutdown, and `legacy.caller`: each legacy caller (route, client IP, user agent) the first time a replica sees it |
| `debug` | Adds a line per request (`request completed`), per 404, per state read, and per legacy hit (`legacy.hit`, with all of the caller's headers) |
| `trace` | Adds `incoming request` |

Polls are counted rather than logged: the `legacy.hits` and
`legacy.response_time` metrics count every legacy request, at any level.
Tracing follows the same split. Every state change and history read is
traced (`SENTRY_TRACES_SAMPLE_RATE`, default `1.0`). Everything else is
sampled at `SENTRY_ROUTINE_TRACES_SAMPLE_RATE` (default `0.01`): polls, 404s,
and background config reloads. That rate is enough for latency and
throughput.

To look at the traffic itself for a while, apply with
`-var="log_level=debug"`, then apply without it to go back. A quicker
toggle is `az containerapp update -n spacestate -g pixelbar-spacestate
--set-env-vars LOG_LEVEL=debug`, but the next `terraform apply` resets it.

Credentials never go with it. The legacy endpoints take their device token in
the query string, so every URL is redacted on the way out by
`src/observability/redact.ts` — the whole query string on the legacy routes,
`token`-style parameters elsewhere. It is wired into the pino request
serializer, the error handler, the legacy caller metrics and Sentry's
`beforeSend`/`beforeSendSpan`/`beforeSendLog` hooks, and unknown paths answer a
generic `404 {"error":"not_found"}` instead of echoing the URL. Anything new
that logs or reports a URL should use that helper.

## CI/CD

`.github/workflows/ci.yml` typechecks, builds, runs unit + integration tests
(against Azurite), builds the Docker image, and on PRs requires a
`CHANGELOG.md` entry under `## [Unreleased]` (label a PR `skip-changelog`
for pure chores).

`.github/workflows/changelog-merge.yml` keeps open PRs mergeable: when `main`'s
`CHANGELOG.md` changes (and after a release empties `[Unreleased]`), it merges
`main` into every open PR that edits the file and, if `CHANGELOG.md` is the only
conflict, resolves it by keeping both sides' entries and pushes that merge.
It comments on the PR either way, and leaves anything it can't resolve safely
to a person. `just changelog-merge` does the same in a stopped local merge or
rebase.

Releases are cut from `main` via Actions → Release → Run workflow. It turns
`[Unreleased]` into a dated version (`Added` → minor, anything else → patch,
never 1.0 automatically), bumps `package.json`/`package-lock.json` and the
spec's `info.version`, commits `Release vX.Y.Z`, tags it, opens a GitHub
Release, and pushes
`ghcr.io/pixelbar/spacestate:{vX.Y.Z,<sha>,latest}`. A `deploy` job
then waits for approval of the GitHub Environment `prod`, rolls the Container
App to the `<sha>` image with `az containerapp update`, and waits for
`/healthz`. Terraform ignores the image (`lifecycle.ignore_changes`), so
`terraform apply` never rolls prod back; it only manages infrastructure.
In parallel with the deploy, `docs-build`/`docs-deploy` publish the docs site
to GitHub Pages from the same commit — publishing docs needs no `prod`
approval, and a failed deploy does not hold the site back.
The bot pushes to `main`, so if branch protection is on, allow
`github-actions[bot]` to bypass it.

To try a pull request on Azure before merging it, Actions → Deploy dev puts it
on the separate dev environment (see "Dev environment").

### Changelog conflicts

The changelog merge workflow works out of the box, with one caveat: pushes made
with `GITHUB_TOKEN` don't start CI, and can't carry workflow changes from `main`
into a branch. A GitHub App fixes both. Create one on the org with **Contents**,
**Pull requests** and **Workflows**: read and write, install it on
`pixelbar/spacestate`, then:

```sh
gh variable set CHANGELOG_BOT_CLIENT_ID --body "<the App's client ID>"
gh secret set CHANGELOG_BOT_PRIVATE_KEY < app-private-key.pem
```

Until that exists, the workflow pushes with `GITHUB_TOKEN`, its PR comment says
CI hasn't run on the merge (push again, or close and reopen the PR), and a merge
that would bring in workflow changes is refused.

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

## Dev environment

A second deployment for trying a pull request on real Azure before it merges,
such as the stacked notification PRs, without going near production. It is the
same Terraform root with `environment = "dev"` (`infra/environment.tf`): its
own resource group (`pixelbar-spacestate-dev`), storage account (so its own
state history, config blobs and webhooks), Container App and Terraform state.
Nothing is shared with prod, and the space's hardware only knows prod's
hostnames. Dev serves its `*.azurecontainerapps.io` hostname, which the deploy
links to, and scales to zero like prod.

### Deploying a pull request

Actions → Deploy dev → Run workflow, with a PR number, branch or SHA, or from a
clone:

```sh
just deploy-dev 36    # or a branch or SHA; default: the current branch
```

`.github/workflows/deploy-dev.yml` resolves the ref to a commit in this
repository (forks are refused: their code would run with dev's Azure
identity), runs that commit's `just check`, publishes
`ghcr.io/pixelbar/spacestate:<sha>` and `:dev`, applies that commit's `infra/`
to dev, rolls the app to the image and waits for `/healthz`. Applying the PR's
Terraform is the difference from a Release, and the point: a PR that adds a
blob container, an env var or a role gets it on dev too.

- **Each run replaces what dev was running.** Runs queue rather than overlap.
  Say so before deploying over someone else's test.
- **For a stack, deploy the PR you want to test up to.** A PR's head contains
  every PR below it, so the top of the notifications stack (IRC) has all of
  them, and the bottom (core) only the dispatcher.
- **A commit from before dev existed is refused**, because its Terraform only
  knows prod's names. Merge `main` into the branch first (for a stack, into the
  bottom PR, then upwards).
- **Dev's data is disposable**, and dev's notification channels must point at
  test accounts (a Mastodon test account, an IRC channel of your own), never
  the space's. A state change on dev is real to whoever follows the channel.

### Configuring dev

The config commands take `--env dev`, which uses `config/dev/` (gitignored) and
`$SPACESTATE_DEV_STORAGE_ACCOUNT`, so a dev copy can never be pushed to prod:

```sh
just pull --env dev
just edit api-keys --env dev
just push --env dev
```

`just tf-dev <command>` is Terraform on dev: dev's backend
(`infra/backend.dev.azurerm.hcl`), its own `infra/.terraform-dev/`, and
`environment=dev`. Plain `terraform` in `infra/` is still prod. Pairing one
environment's variables with the other's state stops at plan time instead of
replacing everything (`terraform_data.environment`).

### Destroying dev between features

Between stretches of feature work, take dev down with Actions → Destroy dev
(or `just destroy-dev`), and bring it back with the next Deploy dev:

- **Removed:** the Container App, its Container Apps environment, the Log
  Analytics workspace (dev deletes it outright rather than soft-deleting it, so
  it can be recreated under the same name), and the app's role assignments.
- **Kept:** the resource group and the storage account, so dev's config blobs,
  state history and webhooks survive, and the next deploy needs no setup. It
  comes back at a new `*.azurecontainerapps.io` hostname, which the deploy links
  to.

It shares Deploy dev's queue, so it never lands in the middle of a deploy, and
it destroys with the Terraform of the commit dev was running (from the image
tag), so a pull request's extra resources go too. Running it when dev is
already down changes nothing.

Idle dev was already cheap: it scales to zero, and storage costs cents. What
this removes is the rest: replicas woken by scanners, and Log Analytics
ingestion.

The resource group stays because dev's CI identity is scoped to it. Deleting it
deletes that identity's role assignments too, and only the one-time setup
restores them.

### One-time dev setup

An admin does this once. First create dev from a laptop, because the CI
identity is scoped to the resource group that this creates:

```sh
az storage container create --account-name pixelbartfstate --name spacestate-dev --auth-mode login
just tf-dev init
just tf-dev apply -var="container_image=ghcr.io/pixelbar/spacestate:latest" -var="sentry_enabled=false"
```

Then give it config. The app does not start without all three blobs. Don't
use the samples: their keys are public.

```sh
echo "SPACESTATE_DEV_STORAGE_ACCOUNT=$(just tf-dev output -raw storage_account_name)" >> .env
mkdir -p config/dev
cp config/spaceapi.sample.json config/dev/spaceapi.json
just api-key tester --role write > config/dev/api-keys.yaml
echo 'legacyDevices: []' > config/dev/legacy.yaml
just push --env dev
```

Next, create the identity the workflow logs in as. It is separate from prod's
and can reach only dev's resource group and dev's state container. It may grant
the app its storage roles (Storage Blob Data Reader and Contributor, Storage
Table Data Contributor) and no others. If a PR needs another role on dev,
extend the condition to include it.

```sh
SUB=$(az account show --query id -o tsv)
RG_SCOPE="/subscriptions/$SUB/resourceGroups/pixelbar-spacestate-dev"

APP_ID=$(az ad app create --display-name spacestate-github-dev --query appId -o tsv)
az ad sp create --id "$APP_ID"
az ad app federated-credential create --id "$APP_ID" --parameters '{
  "name": "github-dev",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:pixelbar/spacestate:environment:dev",
  "audiences": ["api://AzureADTokenExchange"]
}'

az role assignment create --assignee "$APP_ID" --role Contributor --scope "$RG_SCOPE"
# Storage Blob Data Reader, Storage Blob Data Contributor, Storage Table Data Contributor
ROLES="2a2b9908-6ea1-4ae2-8e65-a410df84e7d1, ba92f5b4-2d11-453d-a403-e96b0029c9fe, 0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3"
CONDITION=$(cat <<EOF
((!(ActionMatches{'Microsoft.Authorization/roleAssignments/write'}))
  OR (@Request[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {$ROLES}))
AND
((!(ActionMatches{'Microsoft.Authorization/roleAssignments/delete'}))
  OR (@Resource[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {$ROLES}))
EOF
)
az role assignment create --assignee "$APP_ID" --role "Role Based Access Control Administrator" \
  --scope "$RG_SCOPE" --condition-version 2.0 --condition "$CONDITION"
az role assignment create --assignee "$APP_ID" --role "Storage Blob Data Contributor" \
  --scope "/subscriptions/$SUB/resourceGroups/pixel-bootstrap/providers/Microsoft.Storage/storageAccounts/pixelbartfstate/blobServices/default/containers/spacestate-dev"
```

Finally, create GitHub Environment `dev` with that client ID. The tenant and
subscription come from the repository's variables.

```sh
gh api -X PUT repos/pixelbar/spacestate/environments/dev
gh variable set AZURE_CLIENT_ID --env dev --body "$APP_ID"
gh secret set SENTRY_DSN --env dev    # optional: dev's errors in Sentry, environment "dev"
```

Anyone with write access can then deploy to dev. Add required reviewers to
the `dev` environment if that is too loose.

To remove dev entirely, data and resource group included, an admin runs
`just tf-dev state rm terraform_data.environment`, then
`just tf-dev destroy -var="container_image=unused" -var="sentry_enabled=false"`.
Deleting the resource group also deletes the CI identity's role assignments,
so bringing dev back afterwards means the one-time setup again. For a pause,
use Destroy dev.
