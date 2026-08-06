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
#
# The dumps are readable by root and nobody else. What is in one is every
# password hash, the encrypted MT5 credentials, every session's token hash and
# the whole trading book — the same contents as the database, with none of the
# database's access control in front of it. They were being written 0644 into a
# 0755 directory, which was safe only because this box happens to have no
# unprivileged users today. That is a fact about the box, not about the backup,
# and the next thing installed here can change it without anyone deciding to.

set -euo pipefail

# Applies to the dump, its directory and the log alike, without each one having
# to remember. `chmod` after the fact would leave a window where the file exists
# and is world-readable, which for a file being streamed a database into is the
# whole time it takes to write.
umask 077

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
  tri-backup verify-restore     restore the newest dump into a scratch database
                                and compare it to the live one (touches neither)
USAGE
}

compose() { cd "$COMPOSE_DIR" && docker compose "$@"; }

do_run() {
  mkdir -p "$BACKUP_DIR"
  # Existing directories keep the mode they were made with, so `umask` above only
  # covers a fresh install. This is what fixes the one already on disk.
  chmod 700 "$BACKUP_DIR"
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

# A dump that was never restored is an assumption. `run` checks that the file is
# valid gzip and mentions the right tables, which is a check on the *file* — it
# says nothing about whether Postgres will accept it or whether what comes back
# out is the book that went in. This restores it for real, into a scratch
# database beside the live one, and compares the two.
#
# The comparison is by `count(*)` and by a checksum over the row text, not by
# `pg_stat_user_tables`. Those are planner estimates and they are zero on a
# freshly restored database until something analyses it — which reads as "every
# trade is missing" and is the first thing this drill appeared to find.
#
# A fresh dump is taken first so the two describe the same moment. Comparing
# against last night's would report every row written since as a restore
# failure.
do_verify_restore() {
  local scratch=tri_restore_drill

  log "verify-restore: taking a fresh dump so live and restored describe one moment"
  do_run >/dev/null || { log "FAIL could not take a dump to verify"; exit 1; }
  local file
  file=$(ls -t "$BACKUP_DIR"/tri-*.sql.gz | head -1)

  psql_in() { compose exec -T postgres psql -U "$DB_USER" -d "$1" -t -A "${@:2}"; }

  psql_in postgres -q -c "DROP DATABASE IF EXISTS $scratch;" >/dev/null 2>&1 || true
  psql_in postgres -q -c "CREATE DATABASE $scratch;" >/dev/null

  if ! gunzip -c "$file" | compose exec -T postgres psql -U "$DB_USER" -d "$scratch" -q -v ON_ERROR_STOP=1 >/tmp/tri-verify-restore.log 2>&1; then
    log "FAIL $(basename "$file") did not restore; see /tmp/tri-verify-restore.log"
    psql_in postgres -q -c "DROP DATABASE IF EXISTS $scratch;" >/dev/null 2>&1 || true
    exit 1
  fi

  local failures=0
  local tables
  tables=$(psql_in "$DB_NAME" -c "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name")
  for table in $tables; do
    local live restored
    live=$(psql_in "$DB_NAME" -c "select count(*) from \"$table\"")
    restored=$(psql_in "$scratch" -c "select count(*) from \"$table\"")
    if [ "$live" != "$restored" ]; then
      log "FAIL $table: $live rows live, $restored restored"
      failures=$((failures + 1))
    fi
  done

  # Counts can match while the values inside them do not — a Decimal that lost
  # its scale, a timestamp that lost its zone. The checksum is over the whole
  # row text of everything that is the client's own record.
  local sum="select md5(string_agg(x, chr(10) order by x)) from (
      select t::text as x from trades t
      union all select f::text from finance_entries f
      union all select p::text from long_positions p
      union all select l::text from learning_entries l
      union all select u.id||u.email||u.password_hash from users u
      union all select tn::text from tenants tn) rows;"
  local live_sum restored_sum
  live_sum=$(psql_in "$DB_NAME" -c "$sum")
  restored_sum=$(psql_in "$scratch" -c "$sum")
  if [ "$live_sum" != "$restored_sum" ]; then
    log "FAIL the restored book does not match: $live_sum live, $restored_sum restored"
    failures=$((failures + 1))
  fi

  # A restore that returns the rows without the constraints is a degraded one:
  # the data is there and nothing stops the next write from breaking it.
  local live_fk restored_fk live_ix restored_ix
  live_fk=$(psql_in "$DB_NAME" -c "select count(*) from information_schema.table_constraints where constraint_schema='public' and constraint_type='FOREIGN KEY'")
  restored_fk=$(psql_in "$scratch" -c "select count(*) from information_schema.table_constraints where constraint_schema='public' and constraint_type='FOREIGN KEY'")
  live_ix=$(psql_in "$DB_NAME" -c "select count(*) from pg_indexes where schemaname='public'")
  restored_ix=$(psql_in "$scratch" -c "select count(*) from pg_indexes where schemaname='public'")
  if [ "$live_fk" != "$restored_fk" ] || [ "$live_ix" != "$restored_ix" ]; then
    log "FAIL structure differs: ${live_fk}fk/${live_ix}ix live, ${restored_fk}fk/${restored_ix}ix restored"
    failures=$((failures + 1))
  fi

  psql_in postgres -q -c "DROP DATABASE $scratch;" >/dev/null

  if [ "$failures" -gt 0 ]; then
    log "FAIL verify-restore: $failures check(s) failed on $(basename "$file")"
    exit 1
  fi
  log "OK verify-restore: $(basename "$file") restores to a database identical to the live one ($live_fk foreign keys, $live_ix indexes, book checksum $live_sum)"
}

case "${1:-status}" in
  run)     do_run ;;
  list)    do_list ;;
  status)  do_status ;;
  restore) shift; do_restore "$@" ;;
  verify-restore) do_verify_restore ;;
  -h|--help|help) usage ;;
  *) usage; exit 2 ;;
esac
