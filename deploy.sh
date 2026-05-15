#!/usr/bin/env bash
# Build amd64 image locally, ship it + .env + compose to blackwhale NAS,
# force-recreate the container. Live at https://campspot.yuweiliang.com.
set -euo pipefail

IMAGE=fredcorn/campspot-checker:amd64-latest
NAS=blackwhale
NAS_PATH=/volume1/docker/campspot-checker
DOCKER=/usr/local/bin/docker
DC=/usr/local/bin/docker-compose

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$repo_dir"

[[ -f .env ]] || { echo "missing .env in repo root" >&2; exit 1; }
[[ -f docker-compose-nas.yml ]] || { echo "missing docker-compose-nas.yml" >&2; exit 1; }

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

step "Building amd64 image"
docker buildx build --platform linux/amd64 -t "$IMAGE" --load .

step "Shipping image to $NAS (~30s over LAN)"
docker save "$IMAGE" | ssh "$NAS" "sudo -n $DOCKER load"

step "Shipping .env + compose"
scp -O docker-compose-nas.yml "$NAS:$NAS_PATH/docker-compose.yml"
scp -O .env "$NAS:$NAS_PATH/.env"
ssh "$NAS" "chmod 600 $NAS_PATH/.env"

step "Force-recreating container"
ssh "$NAS" "cd $NAS_PATH && sudo -n $DC up -d --force-recreate"

step "Recent logs"
sleep 2
ssh "$NAS" "sudo -n $DOCKER logs --tail 15 campspot-checker"

printf '\n\033[1;32mLive: https://campspot.yuweiliang.com\033[0m\n'
