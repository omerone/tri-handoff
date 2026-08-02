import { pruneExpiredRateLimits, pruneExpiredSessions } from '@/lib/db';
import { initializeEnv } from '@/lib/env';
import { refreshDueQuotes } from '@/lib/quotes/refresh';

/**
 * Hourly sweep of expired `sessions` and `rate_limits` rows.
 *
 * Both tables are append-mostly: expired rows are filtered out of every query but nothing
 * deleted them, so both grew without bound. Rate-limit rows are the worse of the two — one
 * row per (bucket, subject) means anyone spraying an endpoint writes rows as fast as they
 * can send requests.
 *
 * A timer inside the app rather than a cron container, because the deployment target is
 * `docker compose up` and a scheduler for two DELETEs would be disproportionate. The sweeps
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
      const [sessions, limits] = await Promise.all([
        pruneExpiredSessions(),
        pruneExpiredRateLimits(),
      ]);
      if (sessions > 0 || limits > 0) {
        console.warn(`[maintenance] pruned ${sessions} sessions, ${limits} rate-limit rows`);
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
