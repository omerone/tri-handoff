# Rate limiting

Every budget in TRi is a fixed window counted in Postgres. There is one mechanism, it is
about a hundred lines, and this page describes what the code does.

> An earlier version of this document described a token-bucket limiter with a Redis backend,
> exponential backoff and per-route middleware. That code existed but was never wired into a
> request path — nothing imported it except its own tests — and it has been removed. It was
> also strictly weaker than what it sat beside: no Redis is deployed, so it always fell back
> to an in-memory map that resets on restart and is not shared between instances.

## The mechanism

**`consumeRateLimit(key, limit, windowMs)`** — `src/lib/db/rate-limit.ts`

One `INSERT … ON CONFLICT DO UPDATE` per call, returning `{ allowed, retryAfterMs, remaining }`.

Three properties follow from it being a row in Postgres rather than a counter in memory:

- **Restarting the app does not hand an attacker a fresh budget.** A process-local counter
  makes a deploy into a free retry window.
- **Several app instances share one budget.** In-memory limits multiply by the number of
  instances, which is the same as not having them.
- **A burst does not deadlock.** The whole read-modify-write is a single statement taking one
  row lock. An interactive transaction was the obvious shape and the wrong one: two
  simultaneous attempts on the same key abort each other under serialisable isolation, and a
  limiter that throws during a burst is worse than no limiter.

Expired rows are deleted by the hourly sweep in `src/instrumentation-node.ts`. Without it the
table grows one row per (bucket, subject) for as fast as anyone can send requests.

## The budgets

All of them live in one table so a review has a single place to read: `LIMITS` in
`src/lib/auth/limits.ts`.

| Budget | Limit | Window | Keyed by |
| --- | --- | --- | --- |
| `loginPerAccount` | 10 | 15 min | email |
| `loginPerIp` | 30 | 15 min | client address |
| `resetPerAccount` | 5 | 60 min | email |
| `resetPerIp` | 15 | 60 min | client address |
| `adminLoginPerAccount` | 5 | 15 min | operator email |
| `adminLoginPerIp` | 10 | 15 min | client address |
| `syncManual` | 6 | 5 min | user |
| `accountDelete` | 5 | 60 min | user |

Login is limited twice on purpose: per account stops someone grinding one trader's password,
per address stops one host spraying many accounts.

Operator login is tighter than a client's — there is no self-service reset behind it,
compromising it exposes every client, and legitimate use is a handful of sign-ins a week.

## Where they are applied

Server actions and route handlers, never middleware. The limiter reads Postgres, and Next
middleware runs on the Edge runtime where there is no database client — which is why a
"middleware rate limiter" in this codebase could never have run.

| Call site | Budget |
| --- | --- |
| `src/app/(auth)/actions.ts` — sign in | `loginPerAccount` + `loginPerIp` |
| `src/app/(auth)/actions.ts` — request a reset | `resetPerAccount` + `resetPerIp` |
| `src/app/admin/actions.ts` — operator sign in | `adminLoginPerAccount` + `adminLoginPerIp` |
| `src/app/(app)/settings/mt5-actions.ts` — connect, manual sync | `syncManual` |
| `src/app/(app)/settings/account-actions.ts` — delete account | `accountDelete` |
| `src/app/api/symbols/route.ts` — symbol search | 60 / minute per user |

Account deletion is on the list because it asks for the password again: behind a session that
may already be stolen, an unbudgeted password prompt is a guessing oracle for the credential
that protects everything else.

## The client address

`clientIp()` in `src/lib/auth/limits.ts`, and the order matters.

`X-Real-Ip` first, because Caddy sets it from `{remote_host}` — the socket peer, which the
caller cannot choose. `X-Forwarded-For` is a list a client may prepend to, and a proxy that
appends rather than overwrites passes the forged entry straight through; taking `split(',')[0]`
from it hands an attacker a fresh bucket per request, which is the same as having no limit.

## The one budget that is not about abuse

`quotes:daily` in `src/lib/quotes/refresh.ts` uses the same counter to meter spending against
the market-data vendor's free plan: 700 credits a day, against the vendor's own 800, so a
manual refresh and the symbol search still have room. Running this one dry postpones a price
to tomorrow; running the vendor's dry returns errors for everything.

## Adding a budget

1. Add it to `LIMITS` with a comment saying why that number.
2. Call `consumeRateLimit(limitKey('bucket', subject), LIMITS.x.limit, LIMITS.x.windowMs)` at
   the top of the action, before any work.
3. On refusal return a message, never throw — `auth.tooManyAttempts` takes the minutes left.

Do not add a second limiting mechanism. Two of them means one is the one nobody maintains.
