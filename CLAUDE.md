# Working on TRi

## Finish every change by deploying it

A change is not done when it compiles. It is done when it is running on
production. Whoever is working here — any agent, any session — ends a completed
piece of work by committing to `master` and pushing.

    git push origin master

That is the whole deploy. `.github/workflows/deploy-vps.yml` takes it from
there: typecheck, the full test suite against a real Postgres, then SSH to the
VPS, rebuild, health-check the result, and roll back to the previous image if
the site does not answer. Nothing else needs to be run by hand, and nothing
should be deployed by hand — the SSH key on the server is locked behind a forced
command and cannot open a shell.

Watch it land rather than assuming it did:

    gh run watch "$(gh run list --workflow=deploy-vps.yml --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status

**Push completed work, not work in progress.** The rule is "every change ends in
production", not "every edit". A half-written feature belongs in the working
tree until it is finished; pushing it starts a real rollout on a real trading
account. If two agents are working at once, expect the deploy to queue —
`concurrency: deploy-vps` runs one at a time and never cancels one midway.

**Do not push red.** Run these first; the workflow runs them anyway and a push
that fails them has spent four minutes to tell you what thirty seconds would
have:

    npm run typecheck && npm run lint && npm run test

The end-to-end suite is not in the deploy gate because it needs a browser and a
seeded database. Run it locally when the change touches a screen:

    npm run test:e2e

## Where production is

`167.233.250.233` — a Hetzner `cx23` named `tri-app`. It is **not** in the
Hetzner project the claude.ai connector is wired to; that project holds four
unrelated servers and looking for TRi there finds nothing. Credentials and the
API token for the right project are in `ops/.secrets.env`, which is gitignored
and must stay that way — **this repository is public.**

`ops/README.md` describes the host-level pieces: the deploy script, the nightly
database backup, and the disk guard.

## Two things that are easy to get wrong here

**The tenant boundary.** `normalizeDomain` is pure host parsing and three
security decisions read its output. A `localhost` → `demo.localhost` alias has
been added to it three times as a development shortcut and removed three times:
it makes every request carrying `Host: localhost` a signed-in client's, in
production as much as in development, and it serves the operator login on a
customer's domain. The one alias that is allowed lives in `resolveTenant`, is an
exact match, and is off in production. `domain.test.ts` and `e2e/smoke.spec.ts`
both guard this.

**Translations.** Every user-visible string comes from `src/messages/*.json`.
Hebrew is the default locale, so a hard-coded English label is invisible to the
person writing it and wrong for the person reading it — and a hard-coded Hebrew
one breaks the English UI. `src/i18n/messages.test.ts` walks every `t()` call
site and fails on a key that does not exist or a message whose placeholders were
not supplied; it is faster to run than to rediscover the bug on screen.
