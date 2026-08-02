'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { isLocale, LOCALE_COOKIE, type Locale } from '@/i18n/config';
import { isTheme, THEME_COOKIE, type Theme } from '@/lib/theme';
import { getSession } from '@/lib/auth/session';
import { isSupportedCurrency } from '@/lib/money/currency';
import { updateUserPreferences } from '@/lib/db';

const ONE_YEAR = 365 * 24 * 60 * 60;

/**
 * Switches the interface language. The cookie is what next-intl reads on the next request;
 * the user row is updated too, so the choice survives a new browser.
 */
export async function setLocaleAction(next: string): Promise<void> {
  if (!isLocale(next)) return;

  const store = await cookies();
  store.set(LOCALE_COOKIE, next, {
    httpOnly: false, // Read only by the server; not a secret, and harmless if scripts see it.
    sameSite: 'lax',
    path: '/',
    maxAge: ONE_YEAR,
  });

  const session = await getSession();
  if (session) await updateUserPreferences(session.ctx, { locale: next as Locale });

  revalidatePath('/', 'layout');
}

/**
 * Switches the theme (SPEC §1.1).
 *
 * Mirrored into a cookie *and* the user row for the same reason as the language: the cookie
 * is what the root layout reads on the very first paint, including on the sign-in screen,
 * and the row is what survives a new browser.
 */
export async function setThemeAction(next: string): Promise<void> {
  if (!isTheme(next)) return;

  const store = await cookies();
  store.set(THEME_COOKIE, next, {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    maxAge: ONE_YEAR,
  });

  const session = await getSession();
  if (session) await updateUserPreferences(session.ctx, { theme: next as Theme });

  revalidatePath('/', 'layout');
}

export async function setDisplayCurrencyAction(next: string): Promise<void> {
  if (!isSupportedCurrency(next)) return;

  const session = await getSession();
  if (!session) return;

  await updateUserPreferences(session.ctx, { displayCurrency: next });
  revalidatePath('/', 'layout');
}
