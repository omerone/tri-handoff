import {
  pruneExpiredAuditLogs,
  pruneExpiredRateLimits,
  pruneExpiredSessions,
  pruneExpiredTwoFactorChallenges,
  repairStoredFigures,
} from '@/lib/db';
import { initializeEnv } from '@/lib/env';
import { verifyMailTransport } from '@/lib/mail/mailer';
import { refreshDueQuotes } from '@/lib/quotes/refresh';
import { runSecurityChecks } from '@/lib/security/security-alerts';

/**
 * Hourly sweep of expired `sessions`, `rate_limits` and audit rows.
 *
 * All three are append-mostly: expired rows are filtered out of every query but nothing
 * deleted them, so they grew without bound. Rate-limit rows are the worst of them — one row
 * per (bucket, subject) means anyone spraying an endpoint writes rows as fast as they can
 * send requests. The audit trail is the slowest and the least escapable: it takes a row for
 * every mutation the product makes, and the disk guard is explicitly forbidden from touching
 * the database volume, so nothing else on the box will ever reclaim it.
 *
 * `audit-retention.ts` was written for this and says so in its own header — "the hourly sweep
 * drops rows past the retention window" — and no sweep ever called it. It does now.
 *
 * A timer inside the app rather than a cron container, because the deployment target is
 * `docker compose up` and a scheduler for three DELETEs would be disproportionate. The sweeps
 * are idempotent, so several app instances running them at once is harmless.
 */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export async function startMaintenanceSweep(): Promise<void> {
  // Initialize environment from secrets manager / .env / environment variables
  // This must be called before any code that depends on env()
  try {
    await initializeEnv();
  } catch (error) {
    // Fatal error during env initialization; exit process
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[startup] Fatal: Failed to initialize environment: ${message}`);
    process.exit(1);
  }

  const sweep = async () => {
    try {
      const [sessions, limits, auditRows, challenges] = await Promise.all([
        pruneExpiredSessions(),
        pruneExpiredRateLimits(),
        pruneExpiredAuditLogs(),
        // Written on every sign-in of an account with 2FA on, and abandoned whenever someone
        // closes the tab at the code step. Nothing else deletes those.
        pruneExpiredTwoFactorChallenges(),
      ]);
      if (sessions > 0 || limits > 0 || auditRows > 0 || challenges > 0) {
        console.warn(
          `[maintenance] pruned ${sessions} sessions, ${limits} rate-limit rows, ` +
            `${auditRows} audit rows, ${challenges} two-factor challenges`,
        );
      }

      /*
       * Figures that are wrong in the database rather than on the screen.
       *
       * Both repairs already run inside `syncMt5`, which is the right place and the wrong only
       * place: automatic sync on sign-in is off by default, because MetaApi bills by the hour a
       * terminal is deployed, so neither runs until somebody presses refresh. A client was left
       * reading a 2,126R average from one bad row for as long as nobody did. Neither repair
       * talks to a broker, so neither has any business waiting for one.
       *
       * Separately from the prune above so a failure in either is still only its own.
       */
      const repaired = await repairStoredFigures();
      if (repaired.priced > 0 || repaired.reclassified > 0) {
        console.warn(
          `[maintenance] priced ${repaired.priced} trade(s) and re-filed ` +
            `${repaired.reclassified} by asset class`,
        );
      }
    } catch (error) {
      // A failed sweep must never take the process down; the next one retries.
      console.error('[maintenance] sweep failed:', error instanceof Error ? error.message : error);
    }
  };

  const timer = setInterval(sweep, SWEEP_INTERVAL_MS);
  // Don't hold the event loop open on shutdown.
  timer.unref?.();

  void sweep();
  startQuoteRefresh();
  startSecurityChecks();

  // Once, not on a timer: it answers a question about configuration, and configuration does
  // not change under a running process. A deploy is when someone is already looking.
  void verifyMailTransport();
}

/**
 * How often the alerting looks at what the trail has collected.
 *
 * Five minutes, which is the cadence `runSecurityChecks` was written for and documented with.
 * Its windows are thirty and sixty minutes wide, so this is well inside them: a burst of
 * failed logins is noticed while it is still happening rather than after it stopped.
 *
 * It is here because it was written and never called — not from a route, not from a timer,
 * not from a script. Brute-force detection, oversized-export detection and the
 * operator-activity threshold all existed, complete, reading tables that until this morning
 * had nothing in them. The trail feeding them is a separate fix; a reader with no schedule
 * and a schedule with no reader are the same amount of monitoring, which is none.
 */
const SECURITY_CHECK_INTERVAL_MS = 5 * 60 * 1000;

function startSecurityChecks(): void {
  const check = async () => {
    try {
      await initializeEnv();
      const alerts = await runSecurityChecks();
      // Each alert has already announced itself — to Slack when a webhook is configured, and
      // to stderr when there is none. This line is the count, so a quiet log is distinguishable
      // from a sweep that never ran.
      if (alerts.length > 0) {
        console.error(`[security] ${alerts.length} alert(s) raised by the periodic check`);
      }
    } catch (error) {
      // Same contract as the other timers: the process outlives a failed pass, and the next
      // one is five minutes away. Monitoring that can take the app down is a liability, not a
      // protection.
      console.error('[security] check failed:', error instanceof Error ? error.message : error);
    }
  };

  const timer = setInterval(check, SECURITY_CHECK_INTERVAL_MS);
  timer.unref?.();

  void check();
}

/**
 * How often the quote refresh looks for work.
 *
 * A minute, because the free market-data plan meters credits per minute and a chunk is
 * exactly one minute's worth — the tick *is* the rate limiter. Almost every tick finds
 * nothing to do and costs one indexed query: prices only go stale after a market close, so
 * the work lands in one burst each evening and the other 1,430 ticks are no-ops.
 */
const QUOTE_TICK_MS = 60 * 1000;

/**
 * Marks long-term positions to market in the background.
 *
 * In the timer rather than on page load, and rather than in a login hook, because a fetch
 * that a user is waiting for is a fetch that has to be fast — and this one is deliberately
 * slow, spreading a portfolio across many minutes to stay inside a free plan. By the time
 * anyone signs in, the prices are already in the database and the page renders from it with
 * no network call at all.
 *
 * Several app instances running this at once is harmless: the credit budget is a row in
 * Postgres, and writing the same quote twice writes the same number twice.
 */
function startQuoteRefresh(): void {
  const tick = async () => {
    try {
      // Idempotent and cached after the first call. Here rather than assumed, because
      // `env()` now throws unless the async load has finished, and this timer is one of the
      // few things that runs before any request has had a reason to trigger it.
      await initializeEnv();
      const outcome = await refreshDueQuotes();
      if (outcome.updated > 0 || outcome.budgetSpent) {
        console.warn(
          `[quotes] ${outcome.updated}/${outcome.due} listings refreshed, ` +
            `${outcome.positions} positions marked${outcome.budgetSpent ? ' (daily budget spent)' : ''}`,
        );
      }
    } catch (error) {
      // Same contract as the sweep: a failed tick must never take the process down, and the
      // next one is sixty seconds away.
      console.error('[quotes] refresh failed:', error instanceof Error ? error.message : error);
    }
  };

  const timer = setInterval(tick, QUOTE_TICK_MS);
  timer.unref?.();

  void tick();
}
