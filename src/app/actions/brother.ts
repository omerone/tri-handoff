'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { BROTHER_COOKIE, isBrother } from '@/lib/household';
import { safeAppPath } from '@/lib/nav';

/**
 * Moves the brother switch: remember the position, then redraw the screen under it.
 *
 * A form action for the same reasons the range picker uses one — it works before the page's
 * JavaScript arrives, and the redirect makes the new position take effect as a full server
 * render rather than as client state that half the page listens to. The cookie is the whole
 * of the persistence: the choice is a viewing preference, not data, and it belongs to the
 * browser that made it — the two brothers at two machines each keep their own position.
 */
export async function applyBrotherAction(formData: FormData): Promise<void> {
  const value = formData.get('brother');
  const path = safeAppPath(formData.get('path'));
  const query = String(formData.get('query') ?? '');

  const jar = await cookies();
  if (isBrother(value)) {
    jar.set(BROTHER_COOKIE, value, {
      // Not a secret — it is a name that is on the screen — and only the server reads it.
      httpOnly: false,
      sameSite: 'lax',
      path: '/',
      maxAge: 365 * 24 * 60 * 60,
    });
  } else {
    // "Both" is the absence of a filter, so it is the absence of the cookie. Deleting rather
    // than storing a sentinel means a stale or renamed value can never masquerade as a person.
    jar.delete(BROTHER_COOKIE);
  }

  redirect(query ? `${path}?${query}` : path);
}
