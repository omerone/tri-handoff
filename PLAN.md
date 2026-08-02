# TRi — Build Plan

**Source of truth:** `docs/SPEC.md` (v0.9). Design/behaviour reference: `docs/tri-prototype.jsx`.
Brief: `CLAUDE-CODE-PROMPT.md`.

---

## 0. Conflicts & open questions (flagged, with the assumption I'm building on)

Where the kickoff prompt and `SPEC.md` disagree, SPEC wins — but in every case below the
prompt reflects a *later* decision in the same spec, so the resolution is consistent. Listed
so nothing is silently dropped.

| # | Item | SPEC says | Prompt says | Building as | Needs client call? |
|---|---|---|---|---|---|
| C1 | Registration | §4: "הרשמה, התחברות, שחזור סיסמה" | No public registration | §2 supersedes §4 — provisioning by super admin only; login + reset only | no |
| C2 | Google login | §4 🔶 open | "No OAuth needed" | Not built | no |
| C3 | Draggable/resizable dashboard grid | §1.1 — cards the user drags & resizes | not mentioned; prototype is a fixed grid | **Fixed responsive grid** (matches prototype). Drag/resize is a real scope item that the prototype dropped | **yes — flag** |
| C4 | Light mode + custom palettes | §1.1 — "תמיכה גם במצב בהיר ופלטות מותאמות" | "Dark mode is the default" | Tokens go through CSS variables so a light theme is a later drop-in; only dark ships now | **yes — flag** |
| C5 | Per-trade journal (notes, tags, rating, emotion, strategy) | §1.1 — adopted from tradeReport | absent from the minimum data model | Schema carries the columns from P1 (`note`, `tags`, `rating`, `mood`, `strategy`); **UI deferred to a P1.9 milestone** | **yes — confirm priority** |
| C12 | Analytics timezone | §3.5 defines sessions as Asia/London/NY | — | One constant, `ANALYTICS_TIME_ZONE = 'Asia/Jerusalem'`, matching the prototype's session boundaries. Weekday, hour, session and the calendar all read from it | **flag** — a trader who relocates, or whose broker server sits elsewhere, would want this per-user. Deliberately one constant so it is a column plus a line to change |
| C6 | Asset classes | §3.5 includes commodities (סחורות) | forex/crypto/indices/stocks | Enum includes `commodities`; symbol map classifies XAUUSD etc. | no |
| C7 | Deposits/withdrawals | §3.2 🔶 open | — | MT5 deal types `balance`/`credit` are stored and excluded from trade stats; surfaced in P2 balance view | no |
| C8 | Finance categories fixed vs free | §3.1 🔶 open | schema has free-text `category` | Seeded default category list, user can type any | no |
| C9 | Recurring expenses | §3.1 🔶 open | `is_recurring` in schema | Supported: flag + monthly materialisation | no |
| C10 | Dividends on long positions | §3.4 🔶 open | — | Not built in P3; schema leaves room | **yes — flag** |
| C11 | tradeReport data migration | §3.6 | — | Not applicable — backfill from MT5 covers it | no |

**RR & risk (documented rule, per prompt):**
`rr = profit / risk`, `risk = |entry_price − sl| × contractValue(symbol) × volume`.
When SL is absent, `rr = null`, the trade is **excluded from every RR aggregate**, and each RR
figure ships with a coverage % (`trades with RR / total trades`). `contractValue` comes from a
symbol-spec registry (contract size + quote-currency conversion); unknown symbols fall back to
`rr = null` rather than a wrong number.

---

## Phase 0 — Infrastructure

| M | Milestone | Acceptance criteria |
|---|---|---|
| 0.1 | Repo scaffold | Next 15 App Router + TS strict, Tailwind w/ TRi tokens, Heebo + IBM Plex Mono self-hosted, ESLint + Prettier, Vitest, Playwright. `npm run check` (typecheck + lint + test) green. Docker Compose: app + postgres + Caddy |
| 0.2 | Data layer | Prisma schema for all tables in the brief (+ C5/C6/C7 extensions), migration applied, `db:seed` creates a demo tenant |
| 0.3 | Multi-tenancy | Host-header → tenant middleware; unknown/suspended host → 404/503 page; **all** reads/writes go through `lib/db/*` repositories that take a `TenantContext` — a lint rule forbids importing `prisma` outside `lib/db`. Unit test: repository refuses a cross-tenant id |
| 0.4 | Auth | argon2id hashes, httpOnly/SameSite=Lax/Secure session cookie, session table w/ rotation, logout, password reset by emailed single-use token (SMTP, 30-min TTL), rate limit on `/login`, `/reset`, `/sync` |
| 0.5 | i18n + shell | next-intl he/en, `dir` switching, cookie-persisted language, app shell (header, sync pill, language toggle, nav) pixel-matching the prototype |
| 0.6 | Provisioning | `npm run tenant:create` CLI + `super_admins` login guarding `/admin` with create-tenant form. Enough to onboard client #1 |

**P0 done when:** a seeded tenant domain serves a login page in he-RTL and en-LTR, credentials
log in, session persists, an unknown host is rejected, reset email flow works against MailHog,
`npm run check` green, Playwright smoke passes.

---

## Phase 1 — MT5 sync + analytics (the core)

| M | Milestone | Acceptance criteria |
|---|---|---|
| 1.1 | `Mt5Provider` port | Interface (`connect`, `verify`, `fetchDeals(since)`, `fetchAccountState`). `MockMt5Provider` reproduces the prototype's mulberry32 generator **exactly** (seed 20260731) — a golden-file test locks the output. `MetaApiProvider` behind the same interface, chosen by `MT5_PROVIDER` |
| 1.2 | Account connect + sync | Investor password AES-256-GCM at rest (key from `ENCRYPTION_KEY`), never logged, never returned to the client. First sync = full backfill; later syncs incremental from `last_sync_at`. Idempotent upsert on `(user_id, ticket)`. Every run writes `sync_logs`. Auto-sync on login + manual refresh button (rate limited). UI copy warns: investor password only |
| 1.3 | Analytics engine (pure) | `lib/analytics/*` with zero I/O. Metrics: net P&L, win rate, profit factor, avg RR (+coverage), avg win/avg loss, expectancy, max drawdown, equity curve. Dimensions: weekday, hour, session, direction, asset class, style. **Invariants enforced by tests:** group P&Ls sum exactly to net for every dimension; drawdown equals a brute-force reference; win rate ∈ [0,100]; PF = grossWin/grossLoss; deterministic seeded fixtures; a day trade never spans two calendar days in calendar grouping |
| 1.4 | Dashboard | 6 KPI cards, the **R-strip**, equity curve, recent trades — matching the prototype |
| 1.5 | Analytics page | "Where you're most profitable" ranking (min 5 trades/bucket), 4 breakdown bar cards, day×session heatmap |
| 1.6 | Trades table | Filters (class/direction/style + date range), server-side pagination, live filtered KPI summary |
| 1.7 | Calendar | Month grid, daily P&L + trade count, month navigation |
| 1.8 | Settings + FX | Language, display currency, MT5 account card w/ status + last sync. FX from `FX_API_URL` cached daily in DB, stale-tolerant fallback |
| 1.9 | Per-trade journal (C5) | Trade detail drawer: note, tags, rating, mood, strategy. *Ships only if the client confirms the priority* |

**P1 done when:** login on a tenant domain → sync runs automatically → dashboard, analytics,
trades and calendar match the prototype in behaviour and design → Hebrew RTL and English LTR
both correct → responsive to 375px → `npm run check` green.

---

## Phase 2 — Personal finance ✅
Income/expense entries (ILS-native), categories, recurring entries, monthly + year-to-date
balance, expense breakdown, "total wealth" combining trading equity + long positions + cash
with live FX.

Two corrections to the prototype, both documented in the code:
- its "total wealth" added one month's *net* (a flow) to the trading balance (a stock);
  wealth now uses cumulative recorded cash, and the monthly net keeps its own tile;
- "year to date" summed all twelve months, which projected recurring entries into months
  that had not happened.

## Phase 3 — Manual long positions ✅
Entry, manual mark-to-market with an "updated at" stamp, unrealized and realized P&L kept
apart, close flow, roll-up into total wealth. The portfolio headline reports the *stalest*
open price, since a hand-entered valuation is only as current as the last time it was typed.

## Phase 4 — Super admin ✅
Tenant list ordered worst-first by sync health, per-client detail with sync history, domain
rebinding, rename, suspend/activate, operator-set password for a client who cannot receive
their reset email, and deletion behind a typed confirmation.

---

## Working rules

1. Phases run in order; a phase starts only after the previous one is fully green.
2. After each milestone: `npm run check`, then a commit scoped to that milestone.
3. After each module: a **review subagent** (security, tenant isolation, calculation
   correctness) and a **QA subagent** (tests, with the P1.3 invariants as the floor).
4. Security checklist re-run every phase: tenant scoping in the data layer, investor password
   encrypted and never logged, rate limits on auth + sync, no secrets in the client bundle,
   investor-password-only copy in the UI.

## Environment variables
`DATABASE_URL`, `SESSION_SECRET`, `ENCRYPTION_KEY`, `MT5_PROVIDER=mock|metaapi`,
`METAAPI_TOKEN`, `SMTP_HOST/PORT/USER/PASS/FROM`, `FX_API_URL`, `APP_BASE_DOMAIN`.

## Out of scope
Trade execution, AI assistant, interactive charting with drawing tools, alerts, social
features, native mobile apps, in-app billing.
