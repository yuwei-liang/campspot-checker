#!/usr/bin/env bash
# Build amd64 image from a clean git checkout (HEAD), ship it + .env + compose
# to blackwhale NAS, force-recreate the container.
# Live at https://campspot.yuweiliang.com.
#
# Safety gates (in order):
#   1. Working tree must be clean (no uncommitted/untracked changes)
#   2. `npm test` must pass
#   3. Diff vs. currently-deployed SHA shown for y/N confirmation
#   4. Build context = `git archive HEAD`, so even .gitignored files can't leak
#   5. Image is stamped with org.opencontainers.image.revision=<git sha>
#
# Override gate 1 only with: ALLOW_DIRTY=1 ./deploy.sh
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
fail() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ----- Gate 1: clean working tree -----
step "Checking working tree"
DIRTY="$(git status --porcelain)"
if [[ -n "$DIRTY" ]]; then
    if [[ "${ALLOW_DIRTY:-0}" == "1" ]]; then
        printf '\033[1;33m⚠ Dirty tree allowed via ALLOW_DIRTY=1 — these files will NOT be in the image (build uses git HEAD):\033[0m\n'
        echo "$DIRTY"
    else
        echo "$DIRTY"
        fail "working tree is dirty — commit/stash first, or set ALLOW_DIRTY=1 to deploy git HEAD anyway"
    fi
fi

LOCAL_SHA="$(git rev-parse HEAD)"
LOCAL_SHORT="$(git rev-parse --short HEAD)"
echo "HEAD = $LOCAL_SHORT  ($(git log -1 --pretty='%s'))"

# ----- Gate 2: tests -----
step "Running tests"
npm test --silent

# ----- Gate 3: confirm against deployed SHA -----
step "Comparing against currently-deployed image"
DEPLOYED_SHA="$(ssh "$NAS" "sudo -n $DOCKER inspect --format '{{ index .Config.Labels \"org.opencontainers.image.revision\" }}' campspot-checker 2>/dev/null" | tr -d '[:space:]' || true)"

if [[ -z "$DEPLOYED_SHA" || "$DEPLOYED_SHA" == "<no value>" ]]; then
    echo "(no prior revision label on NAS — first deploy with this script)"
    git log --oneline -10
elif [[ "$DEPLOYED_SHA" == "$LOCAL_SHA" ]]; then
    printf '\033[1;33mNAS already runs %s — nothing to deploy.\033[0m\n' "$LOCAL_SHORT"
    exit 0
else
    DEPLOYED_SHORT="${DEPLOYED_SHA:0:7}"
    printf '%s -> %s\n\n' "$DEPLOYED_SHORT" "$LOCAL_SHORT"
    if git cat-file -e "$DEPLOYED_SHA^{commit}" 2>/dev/null; then
        git --no-pager log --oneline "$DEPLOYED_SHA..HEAD"
        echo
        git --no-pager diff --stat "$DEPLOYED_SHA..HEAD"
    else
        echo "(deployed SHA $DEPLOYED_SHORT not in local git — showing last 10 commits)"
        git --no-pager log --oneline -10
    fi
fi

echo
read -r -p "Proceed with deploy? [y/N] " confirm
[[ "$confirm" == "y" || "$confirm" == "Y" ]] || fail "aborted"

# ----- Build (from git archive — no untracked files) -----
step "Building amd64 image from git $LOCAL_SHORT"
git archive --format=tar HEAD | docker buildx build \
    --platform linux/amd64 \
    -t "$IMAGE" \
    --label "org.opencontainers.image.revision=$LOCAL_SHA" \
    --load -

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

printf '\n\033[1;32mLive: https://campspot.yuweiliang.com  (revision %s)\033[0m\n' "$LOCAL_SHORT"
