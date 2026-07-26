#!/usr/bin/env bash
# Build the AFFiNE all-in-one docker image locally and optionally push it to
# your own registry. Mirrors .github/workflows/build-images.yml, single-arch.
#
# Usage:
#   scripts/build-local-image.sh                      # build only, local tag
#   REGISTRY=registry.example.com/affine PUSH=1 \
#     scripts/build-local-image.sh                    # build + push
#
# Env vars:
#   REGISTRY   image repository (default: affine-custom, no push target)
#   TAG        image tag (default: doc-tree-<git short sha>)
#   PLATFORM   docker platform (default: linux/amd64)
#   PUSH       set to 1 to docker push after build (default: 0)
#   SKIP_*     SKIP_WEB / SKIP_ADMIN / SKIP_MOBILE / SKIP_SERVER=1 to skip
#              rebuilding those dists (reuse existing output)
#
# NOTE: the production `yarn workspaces focus` step prunes node_modules for
# @affine/server only. The script restores the dev install afterwards
# (`yarn install`), even on failure, but expect a few minutes of churn.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

REGISTRY="${REGISTRY:-affine-custom}"
TAG="${TAG:-doc-tree-$(git rev-parse --short HEAD)}"
PLATFORM="${PLATFORM:-linux/amd64}"
PUSH="${PUSH:-0}"
IMAGE="$REGISTRY:$TAG"

restore_install() {
  echo "==> restoring dev node_modules (yarn install)"
  yarn install
}
trap restore_install EXIT

export BUILD_TYPE="${BUILD_TYPE:-stable}"

if [ "${SKIP_WEB:-0}" != "1" ]; then
  echo "==> building @affine/web"
  yarn affine @affine/web build
fi
if [ "${SKIP_ADMIN:-0}" != "1" ]; then
  echo "==> building @affine/admin"
  yarn affine @affine/admin build
fi
if [ "${SKIP_MOBILE:-0}" != "1" ]; then
  echo "==> building @affine/mobile"
  yarn affine @affine/mobile build
fi

if [ "${SKIP_SERVER:-0}" != "1" ]; then
  echo "==> building @affine/server-native (rust)"
  yarn affine @affine/server-native build
  # the Dockerfile expects the arch-suffixed file name
  case "$PLATFORM" in
    linux/amd64) NATIVE_FILE=server-native.x64.node ;;
    linux/arm64) NATIVE_FILE=server-native.arm64.node ;;
    linux/arm/v7) NATIVE_FILE=server-native.armv7.node ;;
    *) echo "unsupported PLATFORM: $PLATFORM" >&2; exit 1 ;;
  esac
  cp -f packages/backend/native/server-native.node \
    "packages/backend/native/$NATIVE_FILE"

  echo "==> building @affine/server"
  yarn workspace @affine/server build

  echo "==> pruning node_modules for production (@affine/server)"
  yarn config set --json supportedArchitectures.cpu '["x64", "arm64", "arm"]'
  yarn config set --json supportedArchitectures.libc '["glibc"]'
  yarn workspaces focus @affine/server --production
  yarn workspace @affine/server prisma generate
  # the Dockerfile expects node_modules inside packages/backend/server
  if [ -d "$ROOT/node_modules" ] && [ ! -d "$ROOT/packages/backend/server/node_modules" ]; then
    mv "$ROOT/node_modules" "$ROOT/packages/backend/server/node_modules"
  fi
fi

echo "==> docker build $IMAGE ($PLATFORM)"
docker build \
  --platform "$PLATFORM" \
  -f .github/deployment/node/Dockerfile \
  -t "$IMAGE" \
  .

if [ "$PUSH" = "1" ]; then
  echo "==> docker push $IMAGE"
  docker push "$IMAGE"
  echo "pushed: $IMAGE"
else
  echo "built: $IMAGE (set PUSH=1 REGISTRY=... to push)"
fi

echo ""
echo "deploy with .docker/selfhost/compose.yml:"
echo "  AFFINE_REVISION=$TAG  (and point image: to $REGISTRY/affine)"
