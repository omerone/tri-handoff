import { pruneExpiredRateLimits, pruneExpiredSessions } from '@/lib/db';

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

export function startMaintenanceSweep(): void {
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
}
