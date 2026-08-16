'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { isMember, MEMBER_COOKIE } from '@/lib/household';
import { safeAppPath } from '@/lib/nav';
import { resolveTenant } from '@/lib/tenant/resolve';

/**
 * Moves the member switch: remember the position, then redraw the screen under it.
 *
 * A form action for the same reasons the range picker uses one — it works before the page's
 * JavaScript arrives, and the redirect makes the new position take effect as a full server
 * render rather than as client state that half the page listens to. The cookie is the whole
 * of the persistence: the choice is a viewing preference, and each browser keeps its own.
 *
 * Validated against the household of the tenant this request actually reached, so a name from
 * some other tenant's household — or no household at all — moves nothing.
 */
export async function applyBrotherAction(formData: FormData): Promise<void> {
  const value = formData.get('brother');
  const path = safeAppPath(formData.get('path'));
  const query = String(formData.get('query') ?? '');

  const lookup = await resolveTenant();
  const household = lookup.state === 'unknown' ? [] : lookup.tenant.household;

  if (isMember(household, value)) {
    (await cookies()).set(MEMBER_COOKIE, value, {
      // Not a secret — it is a name that is on the screen — and only the server reads it.
      httpOnly: false,
      sameSite: 'lax',
      path: '/',
      maxAge: 365 * 24 * 60 * 60,
    });
  }

  redirect(query ? `${path}?${query}` : path);
}
