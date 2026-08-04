#!/usr/bin/env bash
#
# tri-deploy — pull master, rebuild, and keep the site up.
#
# Invoked by GitHub Actions over SSH as a forced command, so it takes no
# arguments and cannot be talked into running anything else.
#
# The two failure modes worth designing around are a build that breaks and a
# build that succeeds but produces an app that will not serve. The first is
# handled by building before switching: the running container is untouched
# until a new image exists. The second is handled by health-checking the new
# container against the real URL and rolling back to the previous image if it
# does not answer, because a deploy that leaves the site down is worse than a
# deploy that did not happen.

set -euo pipefail

REPO_DIR=${REPO_DIR:-/opt/tri-handoff}
BRANCH=${BRANCH:-master}
HEALTH_URL=${HEALTH_URL:-http://localhost:3000/login}
HEALTH_HOST=${HEALTH_HOST:-167.233.250.233}
HEALTH_ATTEMPTS=${HEALTH_ATTEMPTS:-30}
HEALTH_INTERVAL=${HEALTH_INTERVAL:-2}
LOG=/var/log/tri-deploy.log

log() {
  local line="$(date '+%Y-%m-%d %H:%M:%S') $*"
  echo "$line"
  echo "$line" >>"$LOG"
}

cd "$REPO_DIR"

# The checkout has picked up edits made directly on the box before, which makes
# `git pull` refuse to fast-forward. The server is not where code is authored,
# so the remote is authoritative and local changes are discarded on purpose.
log "fetching origin/$BRANCH"
git fetch --quiet origin "$BRANCH"
OLD_SHA=$(git rev-parse --short HEAD)
git reset --hard --quiet "origin/$BRANCH"
NEW_SHA=$(git rev-parse --short HEAD)

if [ "$OLD_SHA" = "$NEW_SHA" ]; then
  log "already at $NEW_SHA — rebuilding anyway (a retried deploy should still converge)"
else
  log "$OLD_SHA -> $NEW_SHA"
fi

# Remember what is running now, so a bad rollout has somewhere to go back to.
PREV_IMAGE=$(docker inspect tri-handoff-app-1 -f '{{.Image}}' 2>/dev/null || echo '')
[ -n "$PREV_IMAGE" ] && log "current image ${PREV_IMAGE:7:12}"

log "building"
if ! docker compose build app >>"$LOG" 2>&1; then
  log "FAIL build failed — nothing was swapped, site still serving $OLD_SHA"
  exit 1
fi

log "starting new container"
docker compose up -d postgres app >>"$LOG" 2>&1

health_ok() {
  local code
  for _ in $(seq 1 "$HEALTH_ATTEMPTS"); do
    code=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $HEALTH_HOST" "$HEALTH_URL" || true)
    [ "$code" = "200" ] && return 0
    sleep "$HEALTH_INTERVAL"
  done
  return 1
}

if health_ok; then
  log "OK deployed $NEW_SHA, health check passed"
  exit 0
fi

log "FAIL health check never returned 200 after $((HEALTH_ATTEMPTS * HEALTH_INTERVAL))s"

if [ -z "$PREV_IMAGE" ]; then
  log "ALERT no previous image recorded — cannot roll back, site may be down"
  exit 1
fi

log "rolling back to ${PREV_IMAGE:7:12}"
docker tag "$PREV_IMAGE" tri-handoff-app:latest >>"$LOG" 2>&1
docker compose up -d --no-build app >>"$LOG" 2>&1

if health_ok; then
  log "ROLLED BACK to previous image; $NEW_SHA was not deployed"
else
  log "ALERT rollback did not restore health either — needs a human"
fi
exit 1
