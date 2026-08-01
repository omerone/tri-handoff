# TRi — Trade · Risk · Insight

A multi-tenant trading journal that syncs from MT5 (read-only) and combines it with personal
finance tracking. One codebase, one database; each client gets the product on their own
domain, which resolves to their isolated environment.

Specification: [`docs/SPEC.md`](docs/SPEC.md) (Hebrew, source of truth).
Design reference: [`docs/tri-prototype.jsx`](docs/tri-prototype.jsx).
Build plan and open questions: [`PLAN.md`](PLAN.md).

---

## Getting started

Requires Node 20.9+ (a `.nvmrc` pins 22) and Docker.

```bash
nvm use && npm install
```

```bash
cp .env.example .env
```

Fill in the two secrets — `openssl rand -base64 48` for `SESSION_SECRET`, `openssl rand -base64 32` for `ENCRYPTION_KEY` — then:

```bash
docker compose up -d postgres && npm run db:migrate && npm run db:seed
```

```bash
npm run dev
```

The seed prints the demo credentials. Because tenants are resolved from the Host header,
browse to **http://demo.localhost:3000**, not `localhost` — `localhost` is not a client
domain and correctly returns 404.

To watch the password-reset flow, start the local mail catcher and read it at
http://localhost:8025:

```bash
docker compose --profile dev up -d mailhog
```

## Everyday commands

```bash
npm run check
```

Typecheck, lint and unit + integration tests. The integration tests talk to the local
Postgres, so it needs to be up. This must be green before any milestone is considered done.

```bash
npm run test:e2e
```

Playwright, across a desktop and a mobile viewport. Builds and boots the app itself; needs
the seeded demo tenant.

**Stop `npm run dev` first.** `next dev` and `next build` write to the same `.next`
directory, and a dev server running during the build corrupts it — the symptom is
`TypeError: a[d] is not a function` from the webpack runtime on every route, which looks
like an application bug and is not one. `rm -rf .next` clears it.

## Onboarding a client

```bash
npm run tenant:create -- --name "Yossi Cohen" --domain yossi.tri.app --email yossi@example.com
```

Prints a generated password once. The same thing is available in the operator panel at
`/admin`, which is served **only on `APP_BASE_DOMAIN`** — client domains return 404 for it.
Create the first operator with:

```bash
npm run admin:create -- --email you@example.com
```

Then point the client's DNS at the server. Caddy asks the app whether the host belongs to an
active tenant before requesting a certificate, so no redeploy is needed and nobody can make
the server request certificates for domains it doesn't serve.

## How it fits together

| Area | Where | Note |
|---|---|---|
| Tenant resolution | `src/lib/tenant/resolve.ts` | Derives the host from the proxy headers itself. The middleware also strips and rewrites `x-tri-host`, but the boundary does not depend on the `matcher` regex being exhaustive |
| Data access | `src/lib/db/**` | The only place Prisma is imported. `@/lib/db` exports only functions that take a branded `TenantContext`; the primitives that cannot (login, reset redemption, operator tooling) live in `@/lib/db/unscoped`, which ESLint restricts to the modules that establish identity |
| CSP | `src/middleware.ts` | Per-request nonce with `strict-dynamic`, so `script-src` is real rather than `unsafe-inline` |
| Auth | `src/lib/auth/**` | argon2id, HMAC-signed session cookie over a random token, sessions scoped to the tenant that issued them |
| Secrets | `src/lib/crypto/secretbox.ts` | AES-256-GCM envelope for the MT5 investor password |
| Design tokens | `src/app/globals.css` | CSS variables, so the light theme in SPEC §1.1 is a drop-in |
| i18n | `src/i18n/**`, `src/messages/*.json` | he (RTL, default) and en (LTR); language is a cookie plus a user column, not a URL prefix |

## Deployment

`docker compose up -d --build` brings up Postgres, the app and Caddy. The app container runs
`prisma migrate deploy` on boot. Set `POSTGRES_PASSWORD` (no default — compose refuses to
start without it), `APP_PROTOCOL=https`, a real `APP_BASE_DOMAIN`, and `ACME_EMAIL` for
Let's Encrypt.

Caddy overwrites `X-Forwarded-For` and `X-Real-Ip` with the socket peer rather than
appending, so a client cannot prepend a value and hand itself a fresh rate-limit bucket per
request. Per-IP limits are only meaningful behind that. It also 404s `/api/tls/allow`
publicly — Caddy reaches it over the compose network, and exposed it would answer "is this
domain a client?" to anyone.

Rotating `ENCRYPTION_KEY` makes stored MT5 passwords unreadable — users have to reconnect.

Expired `sessions` and `rate_limits` rows are swept hourly from inside the app
(`src/instrumentation.ts`); there is no cron container to configure.

## Status

Phase 0 (infrastructure) and Phase 1 (MT5 sync + analytics) are complete: connect an
account, backfill its whole history, and read the dashboard, analytics, trades table and
calendar in Hebrew or English. Phases 2–4 (personal finance, manual long positions, the full
operator panel) are still ahead — see [`PLAN.md`](PLAN.md), which also lists what needs a
decision from the client.
