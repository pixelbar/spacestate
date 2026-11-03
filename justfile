set dotenv-load

set shell := ["bash", "-euo", "pipefail", "-c"]

default:
    @just --list

# Install dependencies exactly as locked.
install:
    npm ci

dev:
    npm run dev

typecheck:
    npm run typecheck

build:
    npm run build

test-unit:
    npm run test:unit

# Legacy parity: outputs vs the recorded legacy fixtures (see test/contract/README.md).
test-contract:
    npm run test:contract

# Needs Azurite on :10002 (`just azurite`).
test-integration:
    npm run test:integration

test: test-unit test-contract test-integration

# Everything CI runs for the main check job.
check: typecheck build test

# Local Table Storage emulator for the integration tests.
azurite:
    docker compose up -d azurite

# Build the API reference site into docs/.vitepress/dist/ (what Pages publishes).
docs-build *args:
    npm run --silent docs:build -- {{args}}

# Preview on http://localhost:8000/spacestate/ with hot reload (Ctrl-C to stop).
docs-preview:
    @npm run --silent docs:build -- --prepare-only
    @npx vitepress dev docs --port 8000

# Refresh the copied pixelbar.nl/pixel theme (see AGENTS.md).
pixel-theme:
    @./scripts/pixel-theme.sh

# Fail unless CHANGELOG.md is updated, e.g. `just check-changelog --base origin/main`.
check-changelog *args:
    npm run --silent check-changelog -- {{args}}

# Keeps both sides' entries when that is clearly right, and says why when it isn't.
# Run with node, like the Changelog merge workflow, so it needs no install.
# In a merge or rebase that stopped on CHANGELOG.md: resolve it and stage the file.
changelog-merge:
    node scripts/merge-changelog.ts --git

# Undo with: git config --unset merge.changelog.driver
# Let git do `just changelog-merge` by itself on a CHANGELOG.md conflict (this clone only).
changelog-merge-driver:
    git config merge.changelog.name "Keep both sides' CHANGELOG [Unreleased] entries"
    git config merge.changelog.driver "node scripts/merge-changelog.ts %O %A %B"
    grep -qxF 'CHANGELOG.md merge=changelog' "$(git rev-parse --git-path info/attributes)" 2>/dev/null || \
        echo 'CHANGELOG.md merge=changelog' >> "$(git rev-parse --git-path info/attributes)"

# Move CHANGELOG [Unreleased] into a version, e.g. `just bump --dry-run`.
bump *args:
    npm run --silent bump -- {{args}}

# Live config blobs <-> config/prod/ (gitignored). name: spaceapi | api-keys | legacy (omit for all).
# Needs `az login` and $SPACESTATE_STORAGE_ACCOUNT (or --account NAME in args).
# Add `--env dev` for the dev environment: config/dev/ and $SPACESTATE_DEV_STORAGE_ACCOUNT.

# Diff remote against local; ask before overwriting the local file(s).
pull *args:
    npm run --silent config -- pull {{args}}

# Diff remote against local; ask before overwriting the remote blob(s).
push *args:
    npm run --silent config -- push {{args}}

# Like push, but edit the remote version in $EDITOR first.
edit name *args:
    npm run --silent config -- edit {{name}} {{args}}

# Generate an API key, e.g. `just api-key ha-bridge --role write --add`.
api-key id *args:
    npm run --silent api-key -- {{id}} {{args}}

# Dev's own state and .terraform-dev/, so it never shares an init with prod (README: "Dev environment").
# Terraform on the dev environment, e.g. `just tf-dev plan`.
tf-dev *args:
    cd infra && TF_DATA_DIR=.terraform-dev TF_CLI_ARGS_init="-backend-config=backend.dev.azurerm.hcl" TF_VAR_environment=dev terraform {{args}}

# Put a PR, branch or commit on dev via GitHub Actions, e.g. `just deploy-dev 33` (default: this branch).
deploy-dev ref="":
    #!/usr/bin/env bash
    set -euo pipefail
    ref="{{ref}}"
    ref="${ref:-$(git rev-parse --abbrev-ref HEAD)}"
    # main's workflow, so the deploy steps are the reviewed ones; the ref only supplies the code.
    gh workflow run deploy-dev.yml --ref main -f ref="${ref}"
    echo "Deploying ${ref} to dev. Follow it with: gh run watch"

# Take dev's app and environment down between stretches of feature work; Deploy dev brings it back.
destroy-dev:
    gh workflow run destroy-dev.yml --ref main
    @echo "Destroying dev's app and environment. Follow it with: gh run watch"
