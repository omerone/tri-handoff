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
#
# And then they are encrypted to a key this machine does not have.
#
# File modes protect a backup while it sits here. They protect nothing once it
# travels, and travelling is what a backup is *for* — the copy that matters is
# the one somewhere else, and this box currently holds the only one, on the same
# disk as the database it is a backup of. Encrypting now is what makes that copy
# safe to make: a bucket left public, a disk image sold on, a tarball attached to
# a support thread, all become a file nobody can read.
#
# The server holds the recipient — the public half — and nothing else, so a root
# compromise here cannot read last month's dumps. It could of course dump the
# live database directly, which is the point: this protects the *history*, and
# history is what an attacker cannot otherwise reach.
#
# The private half lives in `ops/.secrets.env`, off this machine. Losing it makes
# every dump unreadable, so it belongs in a password manager as well.

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
LOG=${LOG:-/var/log/tri-backup.log}

# The public half. Written by the install step; see ops/README.md. Not a secret —
# it can only turn a dump into ciphertext, never the reverse.
RECIPIENT_FILE=${RECIPIENT_FILE:-/etc/tri/backup-recipient}

# The private half, for `restore` and `verify-restore`. Deliberately absent on the
# server: an operator supplies it for the few minutes a restore takes.
IDENTITY_FILE=${TRI_BACKUP_IDENTITY:-}

# A dump missing these is not a usable restore point, whatever its size.
REQUIRED_TABLES=(tenants users trades)

# The unencrypted dump currently on disk, if any, so that no exit path can leave
# one behind.
#
# An `EXIT` trap and not a `RETURN` one: a RETURN trap set inside a function stays
# installed after that function returns, and then fires again on the next
# function to return — by which point the `local` it referred to is gone and
# `set -u` kills the script. That happened here, after a restore drill that had
# already succeeded, turning a passing run into a systemd failure.
PLAINTEXT=""
trap 'if [ -n "$PLAINTEXT" ]; then rm -f "$PLAINTEXT"; fi' EXIT

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

Dumps are encrypted to the key in /etc/tri/backup-recipient. Reading one back —
`restore` and `verify-restore` — needs the private half, which is not kept on
this machine:

  TRI_BACKUP_IDENTITY=/path/to/identity tri-backup verify-restore

It is the BACKUP_AGE_IDENTITY line in ops/.secrets.env.
USAGE
}

compose() { cd "$COMPOSE_DIR" && docker compose "$@"; }

# Every dump on disk, newest first, encrypted and legacy alike. One place, so a
# new extension cannot be added to `run` and forgotten in `list` and `status` —
# which is how a retention sweep quietly stops expiring anything.
#
# `|| true` because an unmatched glob is the normal case, not a failure: once the
# last legacy dump expires only one of these two patterns matches anything, `ls`
# exits 2 over the other, and under `set -e` that took `status` down to printing
# nothing at all.
dumps() { ls -t "$BACKUP_DIR"/tri-*.sql.gz.age "$BACKUP_DIR"/tri-*.sql.gz 2>/dev/null || true; }

# Writes the plaintext of a dump to stdout, whichever kind it is.
#
# The legacy branch is not politeness towards old files: the dumps taken before
# this change are the only restore points that exist for the days they cover, and
# a restore path that cannot read them is a restore path that fails on the one
# night it is needed.
decrypt_to_stdout() {
  local file=$1
  case "$file" in
    *.age)
      if [ -z "$IDENTITY_FILE" ]; then
        echo "This dump is encrypted. Set TRI_BACKUP_IDENTITY to the private key file." >&2
        echo "It is the BACKUP_AGE_IDENTITY line in ops/.secrets.env." >&2
        return 3
      fi
      [ -f "$IDENTITY_FILE" ] || { echo "no such identity file: $IDENTITY_FILE" >&2; return 3; }
      age -d -i "$IDENTITY_FILE" "$file"
      ;;
    *) cat "$file" ;;
  esac
}

do_run() {
  mkdir -p "$BACKUP_DIR"
  # Existing directories keep the mode they were made with, so `umask` above only
  # covers a fresh install. This is what fixes the one already on disk.
  chmod 700 "$BACKUP_DIR"
  local recipient
  recipient=$(grep -m1 '^age1' "$RECIPIENT_FILE" 2>/dev/null || true)
  if [ -z "$recipient" ]; then
    log "FAIL no recipient key in $RECIPIENT_FILE; refusing to write a plaintext dump"
    exit 1
  fi

  local stamp file plain
  stamp=$(date '+%Y%m%d-%H%M%S')
  file="$BACKUP_DIR/tri-$stamp.sql.gz.age"
  # Verified before it is encrypted, because every check below reads the dump —
  # and the whole point of the key model is that this machine cannot read it back
  # afterwards. The plaintext exists for the seconds between, inside a 0700
  # directory under `umask 077`, and the trap removes it however this run ends.
  plain="$BACKUP_DIR/.tri-$stamp.sql.gz.plain"
  PLAINTEXT="$plain"

  if ! compose exec -T postgres pg_dump -U "$DB_USER" -d "$DB_NAME" | gzip -9 >"$plain"; then
    log "FAIL pg_dump failed; removing partial dump"
    rm -f "$plain"
    exit 1
  fi

  # Verify before trusting it.
  if ! gzip -t "$plain" 2>/dev/null; then
    log "FAIL $(basename "$file") is not a valid gzip archive; discarding"
    exit 1
  fi

  local body
  body=$(gunzip -c "$plain")
  for table in "${REQUIRED_TABLES[@]}"; do
    if ! grep -q "CREATE TABLE public.$table" <<<"$body"; then
      log "FAIL $(basename "$file") has no definition for '$table'; discarding"
      exit 1
    fi
  done

  if ! age -r "$recipient" -o "$file" "$plain"; then
    log "FAIL could not encrypt $(basename "$file"); removing"
    rm -f "$file"
    exit 1
  fi
  # An empty or truncated ciphertext passes every check above, because every
  # check above ran on the plaintext.
  if [ ! -s "$file" ]; then
    log "FAIL $(basename "$file") encrypted to an empty file; removing"
    rm -f "$file"
    exit 1
  fi

  # Immediately, not at exit: `verify-restore` calls this and then spends minutes
  # restoring and comparing, and the plaintext has no reason to exist for any of
  # it. The trap is the net for the paths that leave through `exit`.
  rm -f "$plain"
  PLAINTEXT=""

  local size rows
  size=$(du -h "$file" | cut -f1)
  rows=$(grep -c '^COPY ' <<<"$body" || true)
  log "OK $(basename "$file") $size encrypted, $rows COPY blocks, all required tables present"

  # Expire old dumps only after a good one has landed, so a run of failures can
  # never leave the directory empty.
  local expired
  expired=$(find "$BACKUP_DIR" \( -name 'tri-*.sql.gz.age' -o -name 'tri-*.sql.gz' \) -mtime +"$RETENTION_DAYS" -print -delete | wc -l)
  [ "$expired" -gt 0 ] && log "expired $expired dump(s) older than ${RETENTION_DAYS}d"

  return 0
}

do_list() {
  if [ -d "$BACKUP_DIR" ] && [ -n "$(dumps)" ]; then
    # shellcheck disable=SC2046
    ls -lh $(dumps) | awk '{print "  " $9 "  " $5 "  " $6 " " $7 " " $8}'
  else
    echo "  (no dumps yet)"
  fi
}

do_status() {
  local count total
  count=$(dumps 2>/dev/null | wc -l)
  total=$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1 || echo 0)
  echo "TRi backups"
  echo "  location  : $BACKUP_DIR"
  echo "  dumps     : $count (keeping ${RETENTION_DAYS} days)"
  echo "  encrypted : to $(grep -m1 '^age1' "$RECIPIENT_FILE" 2>/dev/null || echo 'NOBODY — no recipient key installed')"
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

  # Fail here rather than after the live database has been dropped: `do_run`
  # below takes a snapshot first, and finding out at *that* point that the dump
  # cannot be read leaves the operator having destroyed nothing but also having
  # learned it too late to plan around.
  if [ "${file##*.}" = "age" ] && [ -z "$IDENTITY_FILE" ]; then
    decrypt_to_stdout "$file" >/dev/null || exit 3
  fi

  echo "This REPLACES the live database with $(basename "$file")."
  echo "Everything currently in '$DB_NAME' is dropped. There is no undo."
  read -r -p "Type the word RESTORE to continue: " answer
  [ "$answer" = "RESTORE" ] || { echo "aborted"; exit 1; }

  # Take a dump of the current state first — restoring onto the wrong day is a
  # mistake people make once, and it should be recoverable.
  log "restore requested from $(basename "$file"); snapshotting current state first"
  do_run || { echo "pre-restore snapshot failed; refusing to restore"; exit 1; }

  decrypt_to_stdout "$file" | gunzip -c | compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME"
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

  # The drill needs to read a stored dump, and stored dumps are encrypted — so it
  # needs the private key. That is not a gap in the drill; it is the drill being
  # honest. A restore rehearsal that runs unattended with no secret is a
  # rehearsal against a backup anybody who reaches this disk could also read.
  if [ -z "$IDENTITY_FILE" ]; then
    echo "verify-restore reads a stored dump, and stored dumps are encrypted." >&2
    echo "  TRI_BACKUP_IDENTITY=/path/to/identity tri-backup verify-restore" >&2
    echo "The key is the BACKUP_AGE_IDENTITY line in ops/.secrets.env." >&2
    exit 3
  fi

  log "verify-restore: taking a fresh dump so live and restored describe one moment"
  do_run >/dev/null || { log "FAIL could not take a dump to verify"; exit 1; }
  local file
  file=$(dumps | head -1)

  psql_in() { compose exec -T postgres psql -U "$DB_USER" -d "$1" -t -A "${@:2}"; }

  psql_in postgres -q -c "DROP DATABASE IF EXISTS $scratch;" >/dev/null 2>&1 || true
  psql_in postgres -q -c "CREATE DATABASE $scratch;" >/dev/null

  if ! decrypt_to_stdout "$file" | gunzip -c | compose exec -T postgres psql -U "$DB_USER" -d "$scratch" -q -v ON_ERROR_STOP=1 >/tmp/tri-verify-restore.log 2>&1; then
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
