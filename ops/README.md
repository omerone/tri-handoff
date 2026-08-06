# ops

Host-level pieces of the VPS deployment. Nothing here is imported by the app; it
is kept in the repo so a rebuilt server can be brought back to the same state.

## nginx-tri-app.conf

The reverse proxy in front of the app, and the only thing between the public
internet and a container that trusts what it is told. It was configured on the
box and not kept here, which is exactly how it came to disagree with
`caddy/Caddyfile` — the same proxy for the compose stack — on three points that
each decide something the app cannot check for itself: whose address goes in the
audit trail, which tenant a request belongs to, and whether the on-demand TLS
`ask` endpoint answers strangers. The file says which, and why, at each line.

Two proxies for one app is a standing hazard. If you change one, read the other.

Install:

    install -m 644 ops/nginx-tri-app.conf /etc/nginx/sites-available/tri-app
    ln -sf /etc/nginx/sites-available/tri-app /etc/nginx/sites-enabled/tri-app
    nginx -t && systemctl reload nginx

## tri-disk-guard

A disk watchdog. Repeated `docker compose build` runs left 19 GB of build cache
on a 38 GB disk — at that rate a few more deploys would have filled it, and a
full disk shows up as Postgres refusing writes rather than as an obvious
out-of-space error.

The guard runs hourly and does nothing until usage crosses a threshold. Past
80% it reclaims the apt cache, journal entries older than a week, build cache
older than a week, and dangling images. Past 88% it also drops the whole build
cache. Every one of those is regenerable with no human input, which is the only
category it is allowed to touch — `docker volume prune` appears nowhere, because
it would take `tri-handoff_pgdata`, the only copy of the trading book. The guard
checks that volume is present before and after each run and aborts if it is not.

Install:

    install -m 755 ops/tri-disk-guard.sh /usr/local/bin/tri-disk-guard
    install -m 644 ops/tri-disk-guard.{service,timer} /etc/systemd/system/
    systemctl daemon-reload && systemctl enable --now tri-disk-guard.timer

Check on it with `tri-disk-guard status`; `tri-disk-guard dry-run` prints the
exact commands a reclaim would run without executing any of them.

Container logs are capped separately, in `/etc/docker/daemon.json`
(`max-size: 10m`, `max-file: 3`) — the guard cannot safely truncate a log that
is open for writing, so that growth is bounded at the source instead.

## tri-backup

Nightly `pg_dump`, gzipped, kept 14 days in `/var/backups/tri`. The database is
the only thing here that cannot be rebuilt from this repo, and it had exactly
one copy before this existed. A dump of the current data is 12 KB, so retention
costs nothing worth measuring.

A dump nobody checked is not a backup, so every run gzip-tests the archive and
confirms it contains the `tenants`, `users` and `trades` definitions. A file
that fails either check is deleted rather than left looking valid, and the run
exits non-zero so systemd records the failure. Old dumps are expired only after
a good one lands, so a run of failures cannot empty the directory.

    install -m 755 ops/tri-backup.sh /usr/local/bin/tri-backup
    install -m 644 ops/tri-backup.{service,timer} /etc/systemd/system/
    systemctl daemon-reload && systemctl enable --now tri-backup.timer

`tri-backup status` lists what is on disk. `tri-backup restore <file>` asks for
confirmation and takes a snapshot of the current state before overwriting it.

Backups sit on the same disk as the database, which covers a bad migration or a
mistaken delete but not the loss of the server. Off-site copies are still to do.

## tri-deploy

What `.github/workflows/deploy-vps.yml` runs over SSH once types and tests pass.
It resets the checkout to `origin/master` (the box is not where code is authored,
and local edits there have blocked fast-forwards before), rebuilds, and switches
containers only after the image exists.

It then health-checks the new container against the real URL, and if it never
returns 200 it retags the previous image and brings that back — a deploy that
leaves the site down is worse than one that did not happen. The script exits
non-zero in that case, which fails the workflow.

The GitHub deploy key is installed in `authorized_keys` behind
`command="/usr/local/bin/tri-deploy"` with pty and forwarding disabled, so the
key cannot open a shell even if it leaks.
