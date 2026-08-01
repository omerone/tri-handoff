<!--
  איך משתמשים בקובץ הזה:
  1. חלץ את tri-handoff.zip לתיקיית הפרויקט
  2. פתח טרמינל בתיקייה והרץ: claude
  3. שלח את ההודעה: "Read CLAUDE-CODE-PROMPT.md and start working."
  זהו. כל ההנחיות נמצאות כאן.
-->

# TRi — Production Build Kickoff Prompt

You are building **TRi** ("Trade · Risk · Insight") — a multi-tenant web platform for traders that combines an MT5-synced trading journal with personal finance tracking. This document is your complete brief.

## Read these first (in this order)

1. `docs/SPEC.md` — the full product specification (Hebrew). **This is the source of truth.** You read Hebrew; if anything in this prompt conflicts with SPEC.md, follow SPEC.md and flag the conflict.
2. `docs/tri-prototype.jsx` — the client-approved interactive prototype. It defines the exact design language, screen structure, metrics, and demo-data shape. The production UI must look and behave like it.

## Product summary (condensed from the spec)

- **Distribution:** one codebase, multi-tenant. Each paying client gets the system under **their own custom domain** that resolves to their isolated environment. **One user per tenant** (the client). **No public registration** — tenants are provisioned by a super admin. No billing/subscription module inside the product (clients pay once, externally).
- **MT5:** exactly **one MT5 account per user**, connected server-side with the **investor (read-only) password only**. Sync runs **on every login** plus a manual "refresh" button. On first connect, perform a **full historical backfill** (MT5 keeps complete account history).
- **Scope:** read-only analytics. **No trade execution of any kind.**
- **Modules & phase order:** P0 infrastructure → P1 MT5 sync + full analytics → P2 personal finance (ILS-native income/expenses) → P3 manual long-term positions → P4 full super-admin panel. A minimal tenant-provisioning capability is needed already in P0.
- **i18n:** Hebrew (RTL, default) + English, full switcher. **Display currency** is user-selectable (₪/$/…); combined views use an **auto-fetched FX rate** (daily cache is enough).
- **Analytics** — dimensions: weekday, hour/session (Asia/London/NY), direction (long/short), asset class (forex/crypto/indices/stocks), style (day/swing). Metrics: net P&L, **avg RR (the client's core metric)**, win rate, profit factor, avg win/avg loss, expectancy, max drawdown, equity curve. Views: KPI dashboard with the signature **R-strip**, breakdown bar charts, day×session heatmap, filterable trades table, monthly calendar with daily P&L, "where you're most profitable" ranking.

## Tech stack (opinionated defaults — deviate only with a stated reason)

- **Next.js (App Router) + TypeScript**, Tailwind CSS, `next-intl` for i18n (he/en, RTL/LTR).
- **PostgreSQL + Prisma.**
- **Auth:** credentials (argon2id), secure session cookies, password reset via email. No OAuth needed.
- **Multi-tenancy:** `tenants` table + host-header resolution middleware (custom domains); every query scoped by `tenant_id` through a single data-access layer — never raw per-route queries.
- **MT5 integration behind an interface** `Mt5Provider` with two implementations:
  - `MockMt5Provider` — deterministic seeded demo data (mirror the generator in the prototype) for dev/demo.
  - `MetaApiProvider` — metaapi.cloud SDK (token via env). Selected by `MT5_PROVIDER` env var.
- **FX rates:** free daily API (e.g. frankfurter.app), cached in DB.
- **Tests:** Vitest for units (the analytics engine above all), Playwright for smoke flows. One `npm run check` that runs typecheck + lint + tests.
- **Deploy target:** Docker Compose (app + postgres + Caddy for automatic TLS and per-client custom domains). Keep the app itself platform-agnostic.

## Design tokens (extracted from the prototype — use exactly)

bg `#0A0B0F` · surface `#12141B` · raised `#1A1D26` · line `rgba(255,255,255,.07)` · text `#E8EAF0` · dim `#8A90A3` · brand `#5B8CFF` · positive `#2DD4A7` · negative `#FF5C7A` · warn `#FFB454`. Fonts: **Heebo** (UI) + **IBM Plex Mono** (numbers). Dark mode is the default. Cards with 18px radius, thin borders, calm spacing. Keep the dashboard **R-strip** — it's the product's signature element.

## Data model (minimum viable — extend as needed)

- `tenants(id, name, domain, status, created_at)`
- `users(id, tenant_id UNIQUE, email, password_hash, lang, display_currency)`
- `mt5_accounts(id, user_id UNIQUE, login, server, investor_pw_encrypted, status, last_sync_at)`
- `trades(id, user_id, ticket, symbol, asset_class, direction, style, open_at, close_at, volume, entry_price, exit_price, sl, tp, commission, swap, profit, risk, rr)` — unique on (user_id, ticket)
- `finance_entries(id, user_id, type income|expense, category, label, amount_ils, entry_date, is_recurring)`
- `long_positions(id, user_id, symbol, qty, buy_price, buy_date, current_value, value_updated_at, realized_pnl, closed_at)`
- `sync_logs(id, user_id, started_at, finished_at, status, trades_imported, error)`
- `super_admins(id, email, password_hash)`

**RR definition:** `rr = profit / risk`, where `risk = |entry_price − sl| × contract value × volume`. If SL is missing on a trade, store `rr = null` and **exclude it from RR aggregates** (show the coverage % in the UI). Document this rule in the code.

## Working method — required, not optional

1. **Plan first.** After reading both docs, write `PLAN.md`: map the spec's phases into concrete milestones with acceptance criteria. Maintain a living TODO as you go.
2. **Phase by phase.** P0 → P1 → P2 → P3 → P4. Never start a phase before the previous one passes all checks.
3. **After every milestone:** run `npm run check` (typecheck + lint + tests) and fix everything before moving on. Commit per milestone with clear messages.
4. **Use subagents to verify everything.** After implementing each module, spawn:
   - a **review subagent** auditing security, tenant isolation, and calculation correctness;
   - a **QA subagent** writing/extending tests. For the analytics engine, enforce at minimum these invariants (they caught real bugs in the prototype): every dimension's group P&Ls sum exactly to total net; drawdown matches a brute-force reference; win rate ∈ [0,100]; profit factor = grossWin/grossLoss; deterministic seeded fixtures; day trades never cross midnight in calendar grouping.
5. **Security checklist, every phase:** `tenant_id` scoping verified in the data layer; investor password encrypted at rest (AES-256-GCM, key from env, never logged); rate limiting on auth and sync endpoints; no secrets shipped to the client; UI copy reminds the user to use the **investor** password, never the master password.
6. **Definition of done for P1:** a user logs in on their tenant domain → sync (mock provider) runs automatically → dashboard, analytics, trades table and calendar all match the prototype's behavior and design → works in Hebrew RTL and English LTR → responsive down to mobile.

## Environment variables

`DATABASE_URL`, `SESSION_SECRET`, `ENCRYPTION_KEY`, `MT5_PROVIDER=mock|metaapi`, `METAAPI_TOKEN` (later), `SMTP_*` (password reset), `FX_API_URL`.

## Out of scope — do not build

Trade execution, AI assistant, interactive charting engine with drawing tools, push/email alerts, social features, native mobile apps, in-app billing.

---

**Start now:** read `docs/SPEC.md` and `docs/tri-prototype.jsx`, write `PLAN.md`, present it briefly, then begin Phase 0.
