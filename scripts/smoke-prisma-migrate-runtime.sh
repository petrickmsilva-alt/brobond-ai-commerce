#!/usr/bin/env bash
# ------------------------------------------------------------------
# Brobond AI Commerce OS — Prisma migration runtime smoke test
# (PR010.4.5 — Prisma Migration Runtime Dependencies)
#
# WHY THIS EXISTS
# ---------------
# Render runs `npx prisma migrate deploy` as its `preDeployCommand`, in an
# environment that installs ONLY production dependencies (`npm ci --omit=dev`,
# NODE_ENV=production). The Prisma CLI loads prisma.config.ts, which pulls in
#
#   @prisma/config -> effect -> fast-check   (fast-check is npm-HOISTED)
#
# If any package in that transitive closure is missing from the production
# tree, the CLI aborts before touching the database with:
#
#   Error: Cannot find module 'fast-check'
#
# This test reproduces the exact production runtime: it installs the project in
# a clean directory WITHOUT devDependencies and then loads the Prisma CLI the
# same way the preDeployCommand does. It asserts the CLI loads its config with
# no MODULE_NOT_FOUND — i.e. every runtime dependency the migration path needs
# is really installed by `npm ci --omit=dev`.
#
# It deliberately does NOT require a live database: `prisma migrate deploy`
# without a reachable DB still fully loads the CLI + prisma.config.ts + the
# whole dependency closure, then fails to CONNECT. A connection error proves
# the modules resolved; a MODULE_NOT_FOUND proves they did not. We assert on
# that distinction. Set SMOKE_DATABASE_URL to a real database to also exercise
# an actual `migrate deploy` against it.
# ------------------------------------------------------------------
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/brobond-prisma-smoke.XXXXXX")"
# A syntactically valid but unreachable URL: forces a CONNECTION failure, not a
# module failure, when no real database is provided.
DB_URL="${SMOKE_DATABASE_URL:-postgresql://smoke:smoke@127.0.0.1:1/brobond_smoke}"

log()  { printf '\033[1;34m[smoke]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[smoke] FAIL:\033[0m %s\n' "$*" >&2; exit 1; }
pass() { printf '\033[1;32m[smoke] PASS:\033[0m %s\n' "$*"; }

cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

log "Reproducing the Render preDeploy runtime in: $WORKDIR"

# --- 1. Assemble a minimal project the CLI needs, then production-install -----
cp "$REPO_ROOT/package.json"      "$WORKDIR/"
cp "$REPO_ROOT/package-lock.json" "$WORKDIR/"
cp "$REPO_ROOT/prisma.config.ts"  "$WORKDIR/"
cp -R "$REPO_ROOT/prisma"         "$WORKDIR/prisma"

cd "$WORKDIR"

log "npm ci --omit=dev  (production-only tree, as Render's preDeployCommand env)"
# NODE_ENV=production mirrors Render and belt-and-braces the dev omission.
NODE_ENV=production npm ci --omit=dev --no-audit --no-fund

# --- 2. Assert the Prisma migration runtime closure is present ---------------
log "Verifying required runtime packages exist in the production tree"
REQUIRED_PKGS=(prisma @prisma/config @prisma/client effect fast-check pure-rand empathic pg typescript)
for pkg in "${REQUIRED_PKGS[@]}"; do
  if [ ! -e "node_modules/$pkg" ]; then
    fail "production tree is missing '$pkg' — 'prisma migrate deploy' would break at runtime"
  fi
  log "  found node_modules/$pkg"
done
pass "all required migration-runtime packages are installed by npm ci --omit=dev"

# --- 3. Run the exact preDeployCommand and inspect module resolution ---------
log "Running: npx prisma migrate deploy (DATABASE_URL=<unreachable unless SMOKE_DATABASE_URL set>)"
set +e
OUTPUT="$(DATABASE_URL="$DB_URL" npx --no-install prisma migrate deploy 2>&1)"
STATUS=$?
set -e

printf '%s\n' "$OUTPUT" | sed 's/^/    │ /'

# Hard failure: the exact bug we are fixing.
if printf '%s' "$OUTPUT" | grep -qE "Cannot find module|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND"; then
  fail "Prisma CLI could not resolve a runtime module (this is the PR010.4.5 regression)."
fi

# Proof the CLI + prisma.config.ts fully loaded before any DB work.
if ! printf '%s' "$OUTPUT" | grep -qE "Loaded Prisma config|Prisma schema loaded|Datasource"; then
  fail "Prisma CLI did not load its config/schema — dependency closure is incomplete."
fi
pass "Prisma CLI loaded prisma.config.ts and the full dependency closure with no MODULE_NOT_FOUND"

if [ "$STATUS" -eq 0 ]; then
  pass "prisma migrate deploy completed successfully (real database reachable)."
else
  log "prisma migrate deploy exited non-zero — expected without a real database"
  log "(a CONNECTION error here still proves every module resolved; set SMOKE_DATABASE_URL to run a real deploy)."
fi

pass "Prisma migration runtime smoke test succeeded."
