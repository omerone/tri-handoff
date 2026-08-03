'use server';

import { redirect } from 'next/navigation';
import { safeAppPath } from '@/lib/nav';
import { setRangeCookie } from '@/lib/preferences/cookies';
import { parseIsoDate } from '@/lib/time/format';
import { formatRange, parseRange, RANGE_PARAM, type TimeRange } from '@/lib/time/range';

/**
 * Applies the range the picker submitted: remember it, then show it.
 *
 * A form action rather than an `onClick`, so the control works before the JavaScript for the
 * page has loaded and so the custom panel is an ordinary `<details>` with ordinary inputs. The
 * two halves of "apply" are deliberate: the cookie is for the *next* screen, reached by a nav
 * link with no query string of its own, and the redirect is for *this* one.
 */
export async function applyRangeAction(formData: FormData): Promise<void> {
  const path = safeAppPath(formData.get('path'));
  const query = new URLSearchParams(String(formData.get('query') ?? ''));

  const range = rangeFromForm(formData);
  if (range) {
    await setRangeCookie(range);
    query.set(RANGE_PARAM, formatRange(range));

    // Both of these name a position inside the *old* window. Page 7 of a filter that now has
    // two pages reads as "no trades match", and a month being browsed that the new range does
    // not contain is a screen showing a period the picker says is not selected.
    query.delete('page');
    query.delete('m');
  }

  const search = query.toString();
  redirect(search ? `${path}?${search}` : path);
}

/**
 * The submitted range, or null to leave the current one alone.
 *
 * Null rather than a fallback to "everything": a browser that let an unparseable date through
 * should return the user to what they were already looking at, not silently widen their view
 * to the whole book.
 */
function rangeFromForm(formData: FormData): TimeRange | null {
  const intent = String(formData.get('intent') ?? '');

  if (intent === 'months') {
    const from = monthField(formData, 'fromMonth');
    const to = monthField(formData, 'toMonth');
    return from && to ? parseRange(`${from}..${to}`) : null;
  }

  if (intent === 'dates') {
    const from = dateField(formData, 'fromDate');
    const to = dateField(formData, 'toDate');
    return from && to ? parseRange(`${from}..${to}`) : null;
  }

  // The presets submit their own token, which `parseRange` is the judge of.
  return parseRange(intent);
}

function monthField(formData: FormData, name: string): string | null {
  const year = String(formData.get(`${name}Year`) ?? '');
  const month = String(formData.get(`${name}Month`) ?? '');
  return /^\d{4}$/.test(year) && /^\d{1,2}$/.test(month)
    ? `${year}-${month.padStart(2, '0')}`
    : null;
}

function dateField(formData: FormData, name: string): string | null {
  // `DateField` posts `yyyy-mm-dd`, and posts nothing at all when what was typed does not
  // parse — so this rejects rather than reinterprets.
  const value = String(formData.get(name) ?? '');
  return parseIsoDate(value) ? value : null;
}
