'use server';

import { getSession } from '@/lib/auth/session';
import { saveDashboardLayout } from '@/lib/db';
import { isDefaultLayout, normalizeLayout } from '@/lib/dashboard/layout';

/**
 * Stores the arrangement the user built (SPEC §1.1).
 *
 * The argument arrives from the browser, so it is treated as untrusted and rebuilt by
 * `normalizeLayout` rather than trusted and written: a span is interpolated straight into a
 * CSS grid, and the list is replayed on every later page load.
 *
 * A layout that matches the default is stored as `null` rather than as itself. That is what
 * makes "reset" mean reset — the row goes back to never-been-touched, so a user who resets
 * keeps following the default if the default ever changes, instead of being frozen on a copy
 * of whatever it happened to be the day they pressed the button.
 *
 * No `revalidatePath`: the client already holds the arrangement it just drew, and
 * invalidating the route would re-run the whole dashboard query — equity curve included —
 * on every nudge of a card.
 *
 * The result is reported rather than swallowed. Returning `void` on "no session" meant the
 * one case where the write silently does nothing — a session revoked or expired while the
 * tab sat open, which is exactly what an operator password reset does — still told the user
 * their layout had been saved.
 */
export type SaveLayoutResult = 'saved' | 'unauthenticated';

export async function saveDashboardLayoutAction(raw: unknown): Promise<SaveLayoutResult> {
  const session = await getSession();
  if (!session) return 'unauthenticated';

  const layout = normalizeLayout(raw);
  await saveDashboardLayout(session.ctx, isDefaultLayout(layout) ? null : layout);
  return 'saved';
}
