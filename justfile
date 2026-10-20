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

# Needs Azurite on :10002 (`just azurite`).
test-integration:
    npm run test:integration

test: test-unit test-integration

# Everything CI runs for the main check job.
check: typecheck build test

# Local Table Storage emulator for the integration tests.
azurite:
    docker compose up -d azurite

# Build the API reference site into docs/dist/ (what GitHub Pages publishes).
docs-build *args:
    npm run --silent docs:build -- {{args}}

# Build it, then preview on http://localhost:8000 (Ctrl-C to stop).
docs-preview: docs-build
    @echo "http://localhost:8000"
    @python3 -m http.server 8000 --directory docs/dist

# Print the live pixelbar.nl/pixel design tokens (see AGENTS.md).
pixel-tokens:
    @./scripts/pixel-tokens.sh

# Fail unless CHANGELOG.md is updated, e.g. `just check-changelog --base origin/main`.
check-changelog *args:
    npm run --silent check-changelog -- {{args}}

# Move CHANGELOG [Unreleased] into a version, e.g. `just bump --dry-run`.
bump *args:
    npm run --silent bump -- {{args}}

# Live config blobs <-> config/prod/ (gitignored). name: spaceapi | api-keys | legacy (omit for all).
# Needs `az login` and $SPACESTATE_STORAGE_ACCOUNT (or --account NAME in args).

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
