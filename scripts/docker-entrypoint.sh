#!/bin/sh
# ------------------------------------------------------------------
# Brobond AI Commerce OS — container entrypoint
#
# WHY THIS EXISTS
# ---------------
# The image used to start with `node server.js`, which skips the one step the
# Render deploy path performs before boot:
#
#   npm run prisma:deploy   (render.yaml `preDeployCommand`)
#
# A container booted without it serves an application whose database has no
# schema at all. That is exactly the production failure this fixes:
#
#   relation "_prisma_migrations" does not exist   (PostgreSQL 42P01)
#   SignupReadinessError: code MIGRATION_PENDING
#
# The signup page was right — the migrations had genuinely never been applied.
# So the container now applies them itself, before accepting any traffic, and
# refuses to start the server if they fail, so a broken release fails
# loudly at boot instead of degrading every request. Readiness itself stays
# observable through the existing /api/health/database probe.
#
# Set RUN_MIGRATIONS=false to opt out when migrations are applied by a separate
# release job (e.g. Render's preDeployCommand) and the web process must not.
# ------------------------------------------------------------------
set -e

log() {
  printf '{"timestamp":"%s","event":"%s","detail":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2"
}

if [ -z "${DATABASE_URL}" ]; then
  log "STARTUP_ABORTED" "DATABASE_URL is not set"
  exit 1
fi

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  log "MIGRATE_DEPLOY_START" "applying pending Prisma migrations"
  # `migrate deploy` is idempotent: it applies only what is missing, creates
  # _prisma_migrations on a virgin database, and never rewrites history.
  # The wrapper also resolves the one known P3009 state left by the pre-PR36
  # outreach migration failure, but only after proving the partial tables are
  # empty so it never discards production data.
  if ! node scripts/prisma-migrate-deploy-with-repair.cjs; then
    log "MIGRATE_DEPLOY_FAILED" "prisma migrate deploy returned a non-zero status"
    exit 1
  fi
  log "MIGRATE_DEPLOY_DONE" "database schema is up to date"
else
  log "MIGRATE_DEPLOY_SKIPPED" "RUN_MIGRATIONS=false"
fi

log "SERVER_START" "starting Next.js standalone server"
exec node server.js
