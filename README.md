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
docker compose up -d azurite
just test-integration  # exercises both the new API and the legacy adapter
```

## Deploying

Infra lives in `infra/` (Terraform, `azurerm` provider). The app serves
`spacestate.pixelbar.nl` and `spaceapi.pixelbar.nl`, the default of
`custom_domains`.

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

The app reads its config from blobs rather than a database, each with a
sample under `config/`:

- `spaceapi.json` — the public SpaceAPI document, exactly as served, minus
  the live fields (`open`, `state.open`), which come from current state
  (`config/spaceapi.sample.json`)
- `api-keys.yaml` — API keys for the `/api/v1` endpoints (`config/api-keys.sample.yaml`)
- `legacy.yaml` — legacy device credentials (`config/legacy.sample.yaml`)
- `notifications.yaml` — where state changes are announced, and the
  credentials to do it (`config/notifications.sample.yaml`). Optional: see
  "Notifications"

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
just edit spaceapi   # or api-keys | legacy | notifications: edit remote in $EDITOR, diff, confirm, push
just pull            # diff remote vs config/prod/ (gitignored), confirm overwriting local
just push            # diff remote vs config/prod/, confirm overwriting remote (add a name for one file)
```

To add an API key: `just api-key <id> --role read|write --add` appends a freshly
generated key to `config/prod/api-keys.yaml`, then `just push api-keys`.

Locally, override the sources with `SPACEAPI_CONFIG_SOURCE`,
`API_KEYS_CONFIG_SOURCE`, `LEGACY_CONFIG_SOURCE` and
`NOTIFICATIONS_CONFIG_SOURCE` (`file://` or `blob://`).

Editing those blobs later takes effect on the next cold start (or within a
few minutes if a replica is already running — see `src/config/loader.ts`),
no redeploy needed.

## Notifications

Every recorded state change — from `/api/v1` or the legacy endpoints, never a
no-op request — is announced to subscribers. The pieces, in `src/notifications/`:

- **`NotificationDispatcher`** fans a change out to every subscriber of every
  source. It is fire-and-forget (the request that changed the state never waits),
  times each attempt out (10 s unless the subscriber says otherwise), retries
  failures after 1 s, 5 s and 30 s, and delivers to each subscriber in order,
  so a retried "open" is never posted after the "closed" that followed it.
  Outcomes go to Sentry Logs (`Notification delivered` / `Notification
  delivery failed`, with the subscriber id).
- **A subscriber** makes one attempt per call and throws to fail it — a
  `DeliveryError` with `retryable: false` when retrying cannot help (a revoked
  token, say).
- **A subscriber source** is asked for its subscribers on every change, so the
  set can change at runtime. `ConfiguredChannels` is the operator's list in
  `notifications.yaml`.

`notifications.yaml` lists channels by `type`, each validated by that type's
schema (so `just edit notifications` catches a misspelt field before it is
pushed), plus the messages they post:

```yaml
timeZone: Europe/Amsterdam        # for {time} and {date}
messages:                         # optional; these are the defaults
  open: "{space} is open."
  closed: "{space} is closed."
channels:
  - type: <channel type>
    id: pixelbar                  # logged as <type>:<id>
    enabled: true                 # false keeps the entry without posting
    messages: { open: "…" }       # optional, overrides the above for this channel
    # …whatever that type needs
```

Placeholders are `{space}` (the SpaceAPI `space` name), `{state}`,
`{previousState}`, `{changedBy}`, `{method}`, `{time}` and `{date}`; an
unknown one fails validation. `{changedBy}` is whoever flipped the switch, so
think before publishing it.

The document is optional. Without it, or while it fails validation, the app
serves state as usual and announces nothing (a broken one is reported to
Sentry); an upload is picked up within five minutes, no restart needed. In
production it sits next to the other config blobs, and holds secrets like
`api-keys.yaml` does.

Adding a channel type is a module exporting a `ChannelType` (a schema that
extends `channelBaseSchema`, and a `create` that returns a subscriber) plus a
line in `src/notifications/channels/index.ts`.

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
config blobs (`spaceapi.json`, `api-keys.yaml`, `legacy.yaml`, `notifications.yaml`), so
Terraform is the one place the DSN lives. Rotating it is an `apply`.

What is reported: 5xx errors (with route/method), config reload and
state-service failures, startup crashes, and every `request.log`/`app.log`
line (as Sentry Logs, via `pinoIntegration`), including state changes and
rejected writes.

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
