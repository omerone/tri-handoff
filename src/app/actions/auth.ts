'use server';

import { redirect } from 'next/navigation';
import { endSession, getSession } from '@/lib/auth/session';
import { SecurityLogger } from '@/lib/security/logger';

export async function signOutAction(): Promise<void> {
  // Read before ending it: afterwards there is no session to name, and a sign-out with no
  // subject is the one entry that makes a trail harder to read rather than easier. It is
  // logged at all because the pair matters — a sign-in with no sign-out to close it, from an
  // address that appears once, is the shape a stolen cookie leaves behind.
  const session = await getSession();
  await endSession();

  if (session) {
    await SecurityLogger.logAuthEvent({
      userId: session.user.id,
      eventType: 'logout',
      description: 'Signed out',
    });
  }

  redirect('/login');
}

/**
 * The same ending, arrived at by running out of time rather than by asking.
 *
 * Separate from `signOutAction` for the trail's sake. "Signed out" and "timed out" look
 * identical afterwards — one row, one session gone — and they mean opposite things when you
 * are reading back a week of somebody's account: one is a person leaving, the other is a
 * machine nobody was at. A stolen cookie shows up as sign-ins that never have a sign-out, and
 * that shape only reads if the two are told apart.
 *
 * `reason` comes from the browser and is therefore not trusted for anything: it picks a
 * sentence on the login page and a word in the log. The session ends either way, and the
 * database had already stopped honouring it — this is what makes the row go and the screen
 * change, not what decides that it should.
 */
export async function expireSessionAction(reason: 'idle' | 'absolute'): Promise<void> {
  const session = await getSession();
  await endSession();

  if (session) {
    await SecurityLogger.logAuthEvent({
      userId: session.user.id,
      eventType: 'session_expired',
      description:
        reason === 'absolute'
          ? 'Session reached its maximum length'
          : 'Session timed out after an hour without activity',
    });
  }

  redirect(`/login?expired=${reason === 'absolute' ? 'absolute' : 'idle'}`);
}
