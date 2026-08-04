#!/usr/bin/env bash
#
# tri-backup — nightly pg_dump of the TRi database.
#
# The database is the only thing on this box that cannot be rebuilt from the
# repo, and until this existed there was exactly one copy of it. A compressed
# dump is a few kilobytes, so retention is generous and the cost is nothing.
#
# A dump that was never checked is not a backup. Every run gunzip-tests the
# archive and greps for the table definitions it must contain; if either fails
# the file is deleted rather than left to look like a good backup, and the run
# exits non-zero so systemd records a failure.

set -euo pipefail

COMPOSE_DIR=${COMPOSE_DIR:-/opt/tri-handoff}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/tri}
RETENTION_DAYS=${RETENTION_DAYS:-14}
DB_USER=${DB_USER:-tri}
DB_NAME=${DB_NAME:-tri}
LOG=/var/log/tri-backup.log

# A dump missing these is not a usable restore point, whatever its size.
REQUIRED_TABLES=(tenants users trades)

log() {
  local line="$(date '+%Y-%m-%d %H:%M:%S') $*"
  echo "$line"
  echo "$line" >>"$LOG"
}

usage() {
  cat <<'USAGE'
tri-backup — nightly database dumps

  tri-backup run                 take a dump, verify it, expire old ones
  tri-backup list                show what is on disk
  tri-backup status             last run, count, total size
  tri-backup restore <file>     restore a dump (asks first — destroys current data)
USAGE
}

compose() { cd "$COMPOSE_DIR" && docker compose "$@"; }

do_run() {
  mkdir -p "$BACKUP_DIR"
  local stamp file
  stamp=$(date '+%Y%m%d-%H%M%S')
  file="$BACKUP_DIR/tri-$stamp.sql.gz"

  if ! compose exec -T postgres pg_dump -U "$DB_USER" -d "$DB_NAME" | gzip -9 >"$file"; then
    log "FAIL pg_dump failed; removing partial $file"
    rm -f "$file"
    exit 1
  fi

  # Verify before trusting it.
  if ! gzip -t "$file" 2>/dev/null; then
    log "FAIL $(basename "$file") is not a valid gzip archive; removing"
    rm -f "$file"
    exit 1
  fi

  local body
  body=$(gunzip -c "$file")
  for table in "${REQUIRED_TABLES[@]}"; do
    if ! grep -q "CREATE TABLE public.$table" <<<"$body"; then
      log "FAIL $(basename "$file") has no definition for '$table'; removing"
      rm -f "$file"
      exit 1
    fi
  done

  local size rows
  size=$(du -h "$file" | cut -f1)
  rows=$(grep -c '^COPY ' <<<"$body" || true)
  log "OK $(basename "$file") $size, $rows COPY blocks, all required tables present"

  # Expire old dumps only after a good one has landed, so a run of failures can
  # never leave the directory empty.
  local expired
  expired=$(find "$BACKUP_DIR" -name 'tri-*.sql.gz' -mtime +"$RETENTION_DAYS" -print -delete | wc -l)
  [ "$expired" -gt 0 ] && log "expired $expired dump(s) older than ${RETENTION_DAYS}d"

  return 0
}

do_list() {
  if [ -d "$BACKUP_DIR" ] && compgen -G "$BACKUP_DIR/tri-*.sql.gz" >/dev/null; then
    ls -lh "$BACKUP_DIR"/tri-*.sql.gz | awk '{print "  " $9 "  " $5 "  " $6 " " $7 " " $8}'
  else
    echo "  (no dumps yet)"
  fi
}

do_status() {
  local count total
  count=$(find "$BACKUP_DIR" -name 'tri-*.sql.gz' 2>/dev/null | wc -l)
  total=$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1 || echo 0)
  echo "TRi backups"
  echo "  location  : $BACKUP_DIR"
  echo "  dumps     : $count (keeping ${RETENTION_DAYS} days)"
  echo "  disk used : ${total:-0}"
  if command -v systemctl >/dev/null; then
    echo "  next run  : $(systemctl list-timers tri-backup.timer --no-pager --no-legend 2>/dev/null | awk '{print $1, $2, $3}' | head -1)"
  fi
  echo
  echo "  on disk:"
  do_list
  echo
  echo "  recent:"
  if [ -f "$LOG" ]; then tail -n 5 "$LOG" | sed 's/^/    /'; else echo "    (no runs yet)"; fi
}

do_restore() {
  local file=${1:-}
  [ -n "$file" ] || { echo "usage: tri-backup restore <file>"; exit 2; }
  [ -f "$file" ] || { echo "no such dump: $file"; exit 2; }

  echo "This REPLACES the live database with $(basename "$file")."
  echo "Everything currently in '$DB_NAME' is dropped. There is no undo."
  read -r -p "Type the word RESTORE to continue: " answer
  [ "$answer" = "RESTORE" ] || { echo "aborted"; exit 1; }

  # Take a dump of the current state first — restoring onto the wrong day is a
  # mistake people make once, and it should be recoverable.
  log "restore requested from $(basename "$file"); snapshotting current state first"
  do_run || { echo "pre-restore snapshot failed; refusing to restore"; exit 1; }

  gunzip -c "$file" | compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME"
  log "RESTORED from $(basename "$file")"
}

case "${1:-status}" in
  run)     do_run ;;
  list)    do_list ;;
  status)  do_status ;;
  restore) shift; do_restore "$@" ;;
  -h|--help|help) usage ;;
  *) usage; exit 2 ;;
esac
