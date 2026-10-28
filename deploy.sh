#!/usr/bin/env bash
set -euo pipefail

TARGET="${TARGET:-synology}"
REMOTE_DIR="${REMOTE_DIR:-/volume5/docker}"
IMAGE="lunatv:custom"
RELEASE="$(date -u +%Y%m%dT%H%M%SZ)"
TEMP_DIR="$(mktemp -d -t lunatv-image)"
IMAGE_TAR="$TEMP_DIR/image.tar"
trap 'rm -rf "$TEMP_DIR"' EXIT

# Restrict values interpolated into the remote shell.
[[ "$REMOTE_DIR" =~ ^/[a-zA-Z0-9_/-]+$ ]] || exit 1
ssh -o BatchMode=yes -o ConnectTimeout=10 "$TARGET" true

echo "Building linux/amd64 image (cached, frozen dependencies)..."
docker build --pull --platform linux/amd64 -t "$IMAGE" .
docker save -o "$IMAGE_TAR" "$IMAGE"
scp -O "$IMAGE_TAR" "$TARGET:$REMOTE_DIR/lunatv-$RELEASE.tar"

ssh "$TARGET" bash -s -- "$REMOTE_DIR" "$RELEASE" <<'REMOTE'
set -euo pipefail
REMOTE_DIR="$1"
RELEASE="$2"
DOCKER=/var/packages/ContainerManager/target/usr/bin/docker
COMPOSE=/var/packages/ContainerManager/target/usr/bin/docker-compose
ARCHIVE="$REMOTE_DIR/lunatv-$RELEASE.tar"
ROLLBACK="lunatv:rollback-$RELEASE"
cd "$REMOTE_DIR"
# Keep the old container serving traffic while loading its replacement.
OLD_IMAGE=$("$DOCKER" inspect --format '{{.Image}}' lunatv)
"$DOCKER" tag "$OLD_IMAGE" "$ROLLBACK"
"$DOCKER" load -i "$ARCHIVE"
rm -f "$ARCHIVE"
EXPECTED=$("$DOCKER" image inspect lunatv:custom --format '{{.Id}}')
recreate() {
  "$COMPOSE" -f docker-compose.yml --env-file .env up -d --no-deps --force-recreate lunatv
}
healthy() {
  for attempt in $(seq 1 45); do
    state=$("$DOCKER" inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' lunatv)
    if [ "$state" = 'running healthy' ]; then return 0; fi
    case "$state" in *unhealthy*|exited*|dead*) return 1;; esac
    sleep 4
  done
  return 1
}
if recreate && healthy && [ "$("$DOCKER" inspect --format '{{.Image}}' lunatv)" = "$EXPECTED" ]; then
  echo "Deployment healthy. Rollback image retained: $ROLLBACK"
else
  echo 'Deployment failed; restoring previous image.' >&2
  "$DOCKER" tag "$ROLLBACK" lunatv:custom
  recreate
  healthy || echo 'Rollback needs attention.' >&2
  exit 1
fi
REMOTE
