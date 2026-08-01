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

Playwright smoke tests across a desktop and a mobile viewport. Builds and boots the app
itself; needs the seeded demo tenant.

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
| Tenant resolution | `src/middleware.ts` → `src/lib/tenant/resolve.ts` | Edge middleware normalises the host and sets `x-tri-host` (stripping any client-supplied value); the Node side looks it up, request-cached |
| Data access | `src/lib/db/**` | The only place Prisma is imported. Every repository takes a branded `TenantContext`; ESLint fails the build if anything else imports the client |
| Auth | `src/lib/auth/**` | argon2id, HMAC-signed session cookie over a random token, sessions scoped to the tenant that issued them |
| Secrets | `src/lib/crypto/secretbox.ts` | AES-256-GCM envelope for the MT5 investor password |
| Design tokens | `src/app/globals.css` | CSS variables, so the light theme in SPEC §1.1 is a drop-in |
| i18n | `src/i18n/**`, `src/messages/*.json` | he (RTL, default) and en (LTR); language is a cookie plus a user column, not a URL prefix |

## Deployment

`docker compose up -d --build` brings up Postgres, the app and Caddy. The app container runs
`prisma migrate deploy` on boot. Set `APP_PROTOCOL=https`, a real `APP_BASE_DOMAIN`, and
`ACME_EMAIL` for Let's Encrypt.

Rotating `ENCRYPTION_KEY` makes stored MT5 passwords unreadable — users have to reconnect.

## Status

Phase 0 (infrastructure) is complete. See [`PLAN.md`](PLAN.md) for what each later phase
covers and what still needs a decision from the client.
