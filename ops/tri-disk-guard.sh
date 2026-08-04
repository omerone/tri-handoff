#!/usr/bin/env bash
#
# tri-disk-guard — keeps the TRi VPS from filling up, without ever touching data.
#
# Runs hourly from a systemd timer. Below WARN_PCT it does nothing but record a
# sample. Past CLEAN_PCT it reclaims regenerable caches; past HARD_PCT it also
# drops the entire Docker build cache, which costs nothing but a slower next
# build.
#
# The whole design rests on one rule: this script only ever deletes things that
# can be recreated from scratch with no human input. That is why there is an
# explicit allowlist of actions rather than a call to `docker system prune`,
# and why `docker volume prune` appears nowhere — it would take pgdata, which
# is the only copy of the trading book, with it. The guard asserts the volume
# is still present before and after every run and refuses to continue if it
# ever is not.

set -euo pipefail

WARN_PCT=${WARN_PCT:-70}
CLEAN_PCT=${CLEAN_PCT:-80}
HARD_PCT=${HARD_PCT:-88}

DATA_VOLUME=tri-handoff_pgdata
LOG=/var/log/tri-disk-guard.log
LOG_MAX_BYTES=$((2 * 1024 * 1024))
DRY_RUN=0

usage() {
  cat <<'USAGE'
tri-disk-guard — disk watchdog for the TRi deployment

  tri-disk-guard check      run the guard (what the hourly timer calls)
  tri-disk-guard status     current usage, thresholds and recent activity
  tri-disk-guard dry-run    show what a run would do, change nothing

Thresholds are overridable: WARN_PCT, CLEAN_PCT, HARD_PCT.
USAGE
}

usage_pct() { df --output=pcent / | tail -1 | tr -dc '0-9'; }
avail_h()   { df -h --output=avail / | tail -1 | tr -d ' '; }
used_h()    { df -h --output=used  / | tail -1 | tr -d ' '; }
size_h()    { df -h --output=size  / | tail -1 | tr -d ' '; }

log() {
  local line="$(date '+%Y-%m-%d %H:%M:%S') $*"
  echo "$line"
  [ "$DRY_RUN" = 1 ] || echo "$line" >>"$LOG"
}

# Keep the log from becoming the thing that fills the disk.
trim_log() {
  [ -f "$LOG" ] || return 0
  local bytes
  bytes=$(stat -c%s "$LOG")
  if [ "$bytes" -gt "$LOG_MAX_BYTES" ]; then
    tail -n 500 "$LOG" >"$LOG.tmp" && mv "$LOG.tmp" "$LOG"
  fi
}

# Refuse to do anything destructive if the data volume is not where we expect.
# A missing volume means something already went wrong, and reclaiming space is
# the last thing that should happen while that is true.
assert_data_volume() {
  if ! docker volume inspect "$DATA_VOLUME" >/dev/null 2>&1; then
    log "ABORT data volume $DATA_VOLUME is missing — refusing to reclaim anything"
    exit 1
  fi
}

run() {
  if [ "$DRY_RUN" = 1 ]; then
    echo "    would run: $*"
  else
    "$@" >/dev/null 2>&1 || true
  fi
}

# --- reclaim steps, all regenerable ------------------------------------------
# Each prints a short label; none can lose state that is not re-derivable.

reclaim_apt_cache() {
  log "  apt cache (re-downloadable)"
  run apt-get clean
}

reclaim_journal() {
  log "  systemd journal older than 7 days"
  run journalctl --vacuum-time=7d
}

reclaim_old_build_cache() {
  log "  docker build cache older than 7 days"
  run docker builder prune -f --filter until=168h
}

reclaim_dangling_images() {
  # Untagged layers no container references. Tagged images stay: one of them is
  # the running app.
  log "  dangling docker images"
  run docker image prune -f
}

reclaim_all_build_cache() {
  log "  entire docker build cache (next build starts cold)"
  run docker builder prune -af
}

do_check() {
  trim_log
  local before_pct before_avail
  before_pct=$(usage_pct)
  before_avail=$(avail_h)

  if [ "$before_pct" -lt "$WARN_PCT" ]; then
    log "OK ${before_pct}% used, ${before_avail} free"
    return 0
  fi

  if [ "$before_pct" -lt "$CLEAN_PCT" ]; then
    log "WARN ${before_pct}% used, ${before_avail} free (clean at ${CLEAN_PCT}%)"
    return 0
  fi

  assert_data_volume

  local tier="CLEAN"
  [ "$before_pct" -ge "$HARD_PCT" ] && tier="HARD"
  log "$tier ${before_pct}% used, ${before_avail} free — reclaiming"

  reclaim_apt_cache
  reclaim_journal
  reclaim_old_build_cache
  reclaim_dangling_images
  [ "$tier" = "HARD" ] && reclaim_all_build_cache

  assert_data_volume

  local after_pct after_avail
  after_pct=$(usage_pct)
  after_avail=$(avail_h)
  log "DONE ${before_pct}% -> ${after_pct}% used, ${after_avail} free"

  if [ "$after_pct" -ge "$HARD_PCT" ]; then
    log "ALERT still ${after_pct}% after reclaiming — needs a human; nothing safe is left to delete"
  fi
}

do_status() {
  local pct bar filled i
  pct=$(usage_pct)
  filled=$((pct / 5))
  bar=""
  for ((i = 0; i < 20; i++)); do
    if [ "$i" -lt "$filled" ]; then bar+="#"; else bar+="."; fi
  done

  local state="OK"
  [ "$pct" -ge "$WARN_PCT" ]  && state="WARN"
  [ "$pct" -ge "$CLEAN_PCT" ] && state="CLEANING"
  [ "$pct" -ge "$HARD_PCT" ]  && state="CRITICAL"

  echo "TRi disk guard"
  echo "  [$bar] ${pct}%  ${state}"
  echo "  $(used_h) used of $(size_h), $(avail_h) free"
  echo "  thresholds: warn ${WARN_PCT}%  clean ${CLEAN_PCT}%  hard ${HARD_PCT}%"
  echo
  echo "  data volume : $(docker volume inspect "$DATA_VOLUME" >/dev/null 2>&1 && echo present || echo MISSING)"
  if command -v systemctl >/dev/null; then
    echo "  next run    : $(systemctl list-timers tri-disk-guard.timer --no-pager --no-legend 2>/dev/null | awk '{print $1, $2, $3}' | head -1)"
  fi
  echo
  echo "  recent:"
  if [ -f "$LOG" ]; then tail -n 8 "$LOG" | sed 's/^/    /'; else echo "    (no runs yet)"; fi
}

case "${1:-check}" in
  check)   do_check ;;
  status)  do_status ;;
  dry-run) DRY_RUN=1; do_check ;;
  -h|--help|help) usage ;;
  *) usage; exit 2 ;;
esac
