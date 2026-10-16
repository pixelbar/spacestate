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

# Needs Azurite on :10002 (`just azurite`).
test-integration:
    npm run test:integration

test: test-unit test-integration

# Everything CI runs for the main check job.
check: typecheck build test

# Local Table Storage emulator for the integration tests.
azurite:
    docker compose up -d azurite

# Fail unless CHANGELOG.md is updated, e.g. `just check-changelog --base origin/main`.
check-changelog *args:
    npm run --silent check-changelog -- {{args}}

# Move CHANGELOG [Unreleased] into a version, e.g. `just bump --dry-run`.
bump *args:
    npm run --silent bump -- {{args}}

# Live config: <name> is spaceapi | api-keys | legacy. Needs `az login` and
# $SPACESTATE_STORAGE_ACCOUNT (or --account NAME in args).

# Pull, edit in $EDITOR, review the diff, confirm, push.
config-edit name *args:
    npm run --silent edit-config -- {{name}} {{args}}

# Save the live blob to config/prod/ (gitignored).
config-pull name *args:
    npm run --silent edit-config -- {{name}} --pull {{args}}

# Validate config/prod/<blob>, review the diff against live, confirm, push.
config-push name *args:
    npm run --silent edit-config -- {{name}} --push {{args}}
