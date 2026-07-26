#!/usr/bin/env bash
# One-command local integration environment for AFFiNE development.
#
# Brings up docker dev dependencies (postgres+pgvector, redis, mailpit,
# manticore), builds the Rust native module and initializes the server DB.
# After this script, start the dev servers in two terminals:
#   yarn affine server dev     # backend on :3010
#   yarn dev                   # frontend web
#
# Usage:
#   scripts/run-integration-env.sh           # full bring-up (deps + native build + init)
#   scripts/run-integration-env.sh --deps    # only docker dependencies
#   scripts/run-integration-env.sh --down    # stop docker dependencies
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
DEV_DOCKER_DIR="$ROOT/.docker/dev"

MODE="${1:-}"

if [ "$MODE" = "--down" ]; then
  docker compose -f "$DEV_DOCKER_DIR/compose.yml" down
  echo "dev services stopped."
  exit 0
fi

# 1. compose + env files
if [ ! -f "$DEV_DOCKER_DIR/compose.yml" ]; then
  cp "$DEV_DOCKER_DIR/compose.yml.example" "$DEV_DOCKER_DIR/compose.yml"
  echo "created .docker/dev/compose.yml from example"
fi
if [ ! -f "$DEV_DOCKER_DIR/.env" ]; then
  cp "$DEV_DOCKER_DIR/.env.example" "$DEV_DOCKER_DIR/.env"
  echo "created .docker/dev/.env from example"
fi
if [ ! -f "$ROOT/packages/backend/server/.env" ]; then
  cp "$ROOT/packages/backend/server/.env.example" "$ROOT/packages/backend/server/.env"
  # the example ships fully commented; enable the local-dev essentials
  sed -i 's/^# *\(DATABASE_URL\|REDIS_SERVER_HOST\|MAILER_HOST\|MAILER_PORT\|MAILER_SECURE\)=/\1=/' \
    "$ROOT/packages/backend/server/.env"
  echo "created packages/backend/server/.env from example (dev vars uncommented)"
fi

# 2. docker dev services
docker compose -f "$DEV_DOCKER_DIR/compose.yml" up -d
echo "waiting for postgres..."
until docker compose -f "$DEV_DOCKER_DIR/compose.yml" exec -T postgres \
  pg_isready -U "${DB_USERNAME:-affine}" >/dev/null 2>&1; do
  sleep 1
done
echo "dev services are up."

if [ "$MODE" = "--deps" ]; then
  exit 0
fi

# 3. rust native module (idempotent)
if ! ls "$ROOT"/packages/backend/native/*.node >/dev/null 2>&1; then
  echo "building @affine/server-native (rust, first build may take a while)..."
  yarn affine @affine/server-native build
else
  echo "server-native already built, skipping (rebuild with: yarn affine @affine/server-native build)"
fi

# 4. init database / seed users
# NOTE: `yarn affine server init` (prisma migrate dev && data-migration run)
# hangs non-interactively on this machine; run the steps separately with CI=1.
CI=1 yarn workspace @affine/server prisma migrate dev --skip-generate
CI=1 yarn workspace @affine/server prisma generate
CI=1 yarn workspace @affine/server data-migration run

cat <<'EOF'

Integration environment is ready.

Next steps (two terminals):
  yarn affine server dev     # backend, http://localhost:3010
  yarn dev                   # frontend web

Seed users:
  dev@affine.pro / dev       (default)
  pro@affine.pro / pro       (pro)
  team@affine.pro / team     (team workspace)

Open the same workspace in two browser profiles to verify doc-tree sync.
EOF
