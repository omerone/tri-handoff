import 'server-only';
import type { TenantContext } from '@/lib/tenant/context';
import { getUser, listMt5Accounts } from '@/lib/db';
import { refreshFxRate } from './fx';

/**
 * Bring this trader's exchange rates up to date, on sign-in.
 *
 * **Why on sign-in rather than on render.** `getFxRate` answers from any rate published in the
 * last few days, which is what stops every page load making an HTTP call across a weekend the
 * feed does not publish on. The cost of that is a rate that can be several days old before
 * anything goes to look: over one such stretch USD/ILS moved 3.0265 → 3.0029, which is 0.8%
 * on every converted figure on the screen. Signing in is the right moment to correct it — it
 * is exactly when somebody is about to read their numbers, it happens once rather than once
 * per page, and nothing is waiting on it.
 *
 * **Which pairs.** Only the ones this trader's screens actually convert: shekels, because the
 * finance ledger is kept in them, and whatever each connected broker account is denominated
 * in. Refreshing the whole matrix would be four times the requests for rates nobody reads.
 *
 * **It cannot fail a login.** Every pair is caught individually, the whole thing is caught
 * again by its caller, and a pair that does not come back simply leaves the previous rate in
 * place — which is the same rate the page would have used anyway.
 */
export async function refreshRatesOnLogin(ctx: TenantContext): Promise<void> {
  const [user, accounts] = await Promise.all([getUser(ctx), listMt5Accounts(ctx)]);
  if (!user) return;

  const display = user.displayCurrency;
  const sources = new Set<string>(['ILS', ...accounts.map((one) => one.accountCurrency ?? 'USD')]);
  sources.delete(display);
  if (sources.size === 0) return;

  await Promise.all(
    [...sources].map((source) =>
      refreshFxRate(source, display).catch((error: unknown) => {
        console.warn(
          `[fx] login refresh failed for ${source}->${display}:`,
          error instanceof Error ? error.message : error,
        );
        return null;
      }),
    ),
  );
}
