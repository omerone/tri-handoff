'use server';

import { revalidatePath } from 'next/cache';
import { isLocale, type Locale } from '@/i18n/config';
import { isTheme, type Theme } from '@/lib/theme';
import { isDisplayStyle, type DisplayStyle } from '@/lib/display-style';
import { getSession } from '@/lib/auth/session';
import {
  setDisplayStyleCookie,
  setLocaleCookie,
  setRangeCookie,
  setThemeCookie,
} from '@/lib/preferences/cookies';
import { parseRange } from '@/lib/time/range';
import { isSupportedCurrency } from '@/lib/money/currency';
import { updateUserPreferences } from '@/lib/db';

/**
 * Switches the interface language. The cookie is what next-intl reads on the next request;
 * the user row is updated too, so the choice survives a new browser.
 */
export async function setLocaleAction(next: string): Promise<void> {
  if (!isLocale(next)) return;

  await setLocaleCookie(next);

  const session = await getSession();
  if (session) await updateUserPreferences(session.ctx, { locale: next as Locale });

  revalidatePath('/', 'layout');
}

/**
 * Switches the theme (SPEC §1.1).
 *
 * Mirrored into a cookie *and* the user row for the same reason as the language: the row is
 * what survives a new browser and what the root layout paints from, and the cookie is what
 * spares every request a query — and what the sign-in screen, which has no row to read, uses.
 *
 * The row is written first, so a failure there leaves both copies on the old value rather
 * than a cookie claiming a change that the authoritative copy never took.
 */
export async function setThemeAction(next: string): Promise<void> {
  if (!isTheme(next)) return;

  const session = await getSession();
  if (session) await updateUserPreferences(session.ctx, { theme: next as Theme });

  await setThemeCookie(next);

  revalidatePath('/', 'layout');
}

/**
 * Switches which of the three visual languages the interface is drawn in.
 *
 * Written in the same order and for the same reasons as the theme: the row first, so a
 * failure leaves both copies on the old value rather than a cookie claiming a change the
 * authoritative copy never took. It changes nothing but how the page is painted — the style
 * is a `data-style` attribute and every rule that reads it lives in globals.css.
 */
export async function setDisplayStyleAction(next: string): Promise<void> {
  if (!isDisplayStyle(next)) return;

  const session = await getSession();
  if (session) await updateUserPreferences(session.ctx, { displayStyle: next as DisplayStyle });

  await setDisplayStyleCookie(next);

  revalidatePath('/', 'layout');
}

/**
 * Remembers the time range the user is reading through.
 *
 * Cookie only — no user row and no `revalidatePath`. The picker pushes the range into the URL
 * in the same gesture, and that navigation is what re-renders the page; revalidating here as
 * well would render every screen twice for one click. The cookie exists for the *next* screen,
 * reached through a nav link that carries no query string.
 */
export async function setRangeAction(next: string): Promise<void> {
  const range = parseRange(next);
  if (!range) return;
  await setRangeCookie(range);
}

export async function setDisplayCurrencyAction(next: string): Promise<void> {
  if (!isSupportedCurrency(next)) return;

  const session = await getSession();
  if (!session) return;

  await updateUserPreferences(session.ctx, { displayCurrency: next });
  revalidatePath('/', 'layout');
}

/**
 * Whether signing in should pull from the broker on its own.
 *
 * Off by default and changed only from settings. It is a preference rather than a constant
 * because the right answer depends on what the trader is paying per call: somebody on a flat
 * plan wants the data waiting for them, and somebody metered wants to decide each time.
 */
export async function setAutoSyncAction(next: boolean): Promise<void> {
  const session = await getSession();
  if (!session) return;

  await updateUserPreferences(session.ctx, { autoSyncOnLogin: next });
  revalidatePath('/', 'layout');
}
