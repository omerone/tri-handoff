# ops

Host-level pieces of the VPS deployment. Nothing here is imported by the app; it
is kept in the repo so a rebuilt server can be brought back to the same state.

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
