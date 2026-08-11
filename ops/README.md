# ops

Host-level pieces of the VPS deployment. Nothing here is imported by the app; it
is kept in the repo so a rebuilt server can be brought back to the same state.

## sshd-hardening.conf

Keys only, plus a firewall and fail2ban. The box was taking roughly 7,700
password guesses against root a day, from 70 addresses, with password
authentication on and nothing rate-limiting them. Root here is the trading book,
the encrypted MT5 credentials, the `ENCRYPTION_KEY` that opens them in the same
`.env`, and every nightly backup.

Install, in this order — the firewall rule for 22 has to exist before the
firewall does, or enabling it ends the session that is typing:

    ufw default deny incoming && ufw default allow outgoing
    ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp
    ufw --force enable

    apt-get install -y fail2ban        # jail.local: bantime 1h, maxretry 5
    systemctl enable --now fail2ban

    install -m 644 ops/sshd-hardening.conf /etc/ssh/sshd_config.d/99-tri-hardening.conf
    sshd -t && systemctl reload ssh    # reload, not restart — it keeps you connected

Then open a **new** connection before closing the old one. That is the whole
safety net for this change.

`ssh-keyscan` no longer runs in the deploy workflow either. It was trust on
first use with no first use: it accepted whatever answered on port 22 and wrote
it down as correct. The server's ed25519 public key is pinned in the
`DEPLOY_HOST_KEY` repository secret.

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

## The domain and TLS

Done on 2026-08-11. The app is served at **https://ester.troinvest.uk** behind
Cloudflare, and the session cookie carries `Secure` — the password no longer
crosses the network in the clear, which was the largest open item in the audit.

    visitor ──TLS──> Cloudflare ──TLS──> nginx :443 ──> app :3000

Two files here are the origin half:

- `nginx-cloudflare-realip.conf` → `/etc/nginx/conf.d/`. Recovers the visitor's
  address from `CF-Connecting-IP`, and only for requests that actually arrived
  from Cloudflare's published ranges — without that second half anyone could send
  the header themselves and rotate it to defeat every per-IP limit. Without the
  file at all, every visitor arrives as a Cloudflare address and the sign-in rate
  limiter either locks out strangers or protects nothing.
- `nginx-tri-app-tls.conf` → `/etc/nginx/sites-available/tri-app`. Serves 443 for
  any host (`server_name _`, mirroring the Caddyfile) because the app resolves the
  tenant from `Host` and refuses one it does not know; naming domains here too
  would mean reloading the proxy to onboard a client, for no protection the app is
  not already giving.

### The certificate renews itself

Let's Encrypt, wildcard, issued through **DNS-01** rather than the usual HTTP-01:
the origin sits behind Cloudflare's proxy, so the ACME server cannot reach port 80
here — and DNS-01 is the only route to a wildcard, which is what lets a new client
be a row in `tenants` instead of a new certificate.

    /etc/letsencrypt/live/troinvest.uk/{fullchain,privkey}.pem
    /etc/letsencrypt/cloudflare.ini          # API token, mode 600
    /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh

That last file matters more than it looks. certbot renews the files on disk;
nginx keeps the old certificate in memory until it is told. Without the hook the
site serves an expired certificate ninety days from now, and the renewal that was
meant to prevent it will have succeeded. `certbot renew --dry-run` exercises the
whole path.

The token in `cloudflare.ini` is scoped to `Zone:DNS:Edit` on this zone alone and
is needed at every renewal, so it stays. Rolling it means writing the new value
there too.

### Zone settings that are load-bearing

- **SSL/TLS mode: Full (strict).** On *Flexible*, Cloudflare speaks plain HTTP to
  this box and the certificate above is never used — a padlock in the browser with
  the password in the clear on the last hop, which is the exact exposure this work
  removed.
- **Email Obfuscation: off.** It rewrites any email address in the HTML at the
  edge and injects a decode script. The footer prints the signed-in user's
  address, so every page came back with markup the server had not rendered and
  React failed hydration on it. Turning it on again brings that back.

### Adding a client

One row. `*.troinvest.uk` already resolves and the wildcard certificate already
covers it, so there is no DNS and no certificate work:

    insert into tenants (…, domain) values (…, 'someone.troinvest.uk');

### The old address

`http://167.233.250.233` redirects to the new hostname — a migration aid, and the
one place a tenant hostname is written into the proxy. Without it that bookmark
ends on a certificate-name mismatch, because the generic redirect sends it to
`https://167.233.250.233` where the certificate is for the domain. Remove the
block once nobody reaches for the old address.

### Still open

**Outbound mail is not wired.** `SMTP_HOST=localhost:1025` points at a dev mailbox
that does not run here, and the app says so in its own log: *"password reset will
accept the request and deliver nothing"*. The screen tells the client an email was
sent and none is. Fixing it needs a real SMTP provider plus SPF/DKIM/DMARC records
on this domain — now possible, since there is a domain.

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

Nightly `pg_dump`, gzipped, encrypted, kept 14 days in `/var/backups/tri`. The database is
the only thing here that cannot be rebuilt from this repo, and it had exactly
one copy before this existed. A dump of the current data is 12 KB, so retention
costs nothing worth measuring.

A dump nobody checked is not a backup, so every run gzip-tests the archive and
confirms it contains the `tenants`, `users` and `trades` definitions. A file
that fails either check is deleted rather than left looking valid, and the run
exits non-zero so systemd records the failure. Old dumps are expired only after
a good one lands, so a run of failures cannot empty the directory.

`tri-backup verify-restore` is the drill, and it had never been run. Everything
`run` checks is a check on the _file_ — valid gzip, the right table definitions
present — which says nothing about whether Postgres will accept it or whether
what comes back out is the book that went in. The drill restores the newest dump
into a scratch database beside the live one and compares the two: row counts per
table, a checksum over the row text of every trade, entry, position, lesson, user
and tenant, and the foreign keys and indexes. First run passed on all three.

It compares by `count(*)`, not by `pg_stat_user_tables`. Those are planner
estimates, they are zero on a freshly restored database until something analyses
it, and reading them is how this drill first appeared to report that every trade
had been lost.

Root-only, `umask 077` and a `0700` directory. A dump holds every password hash,
the encrypted MT5 credentials, every session's token hash and the whole trading
book — the database's contents with none of the database's access control in
front of them. They were `0644` in a `0755` directory, which was safe only
because this box has no unprivileged users today; that is a fact about the box
rather than about the backup.

### Encrypted to a key this machine does not have

File modes protect a dump while it sits here. They protect nothing once it
travels, and travelling is what a backup is for — the copy that matters is the
one somewhere else. Every dump is now `age`-encrypted to a recipient in
`/etc/tri/backup-recipient`, so the offsite copy, whenever it exists, is already
safe to make: a bucket left public, a disk image sold on, a tarball attached to a
support thread all become a file nobody can read.

The server holds only the public half. A root compromise here cannot read last
month's dumps — it could of course dump the live database directly, which is the
point of the split: this protects the *history*, and history is what an attacker
cannot otherwise reach. It was generated off this machine and has never been on
it.

The private half is the `BACKUP_AGE_IDENTITY` line in `ops/.secrets.env`, which
is gitignored — **this repository is public.** Losing it makes every dump
unreadable, by us as much as by anyone, so it belongs in a password manager as
well as in that file.

Reading a dump back therefore takes the key:

    # write the identity to a file the tool can read
    grep '^BACKUP_AGE_IDENTITY=' ops/.secrets.env | cut -d= -f2- > /tmp/id && chmod 600 /tmp/id

    TRI_BACKUP_IDENTITY=/tmp/id tri-backup verify-restore
    TRI_BACKUP_IDENTITY=/tmp/id tri-backup restore /var/backups/tri/tri-....sql.gz.age

    # or, off the box entirely
    age -d -i /tmp/id tri-....sql.gz.age | gunzip -c | psql ...

That the drill needs a secret is not a gap in it. A restore rehearsal that runs
unattended with no key is a rehearsal against a backup anybody who reaches this
disk could also read.

The nightly run needs no key: it dumps, gzip-tests, checks the table definitions
and only then encrypts, so the guarantee that a stored dump is a real one is
unchanged. The plaintext exists for the seconds in between, inside the `0700`
directory, and is removed the moment the ciphertext lands — with an `EXIT` trap
for the paths that leave early.

Still on the same disk as the database it protects. That remains the open item,
and it needs somewhere to go; encryption is what makes sending it there a
decision about storage rather than about trust.

Installing — none of this is deployed by `deploy-vps.yml`, which ships the app
and not the host:

    apt-get install -y age
    mkdir -p /etc/tri && printf '%s\n' "$RECIPIENT" > /etc/tri/backup-recipient
    install -m 755 ops/tri-backup.sh /usr/local/bin/tri-backup
    install -m 644 ops/tri-backup.{service,timer} /etc/systemd/system/
    systemctl daemon-reload && systemctl enable --now tri-backup.timer

`tri-backup status` lists what is on disk and names the recipient it is
encrypting to — or says `NOBODY` if none is installed, which is also what `run`
refuses on rather than writing a plaintext dump.

`tri-backup restore <file>` asks for confirmation and takes a snapshot of the
current state before overwriting it. It checks that it can read the dump *before*
asking, so nobody discovers a missing key after the live database is gone.

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
