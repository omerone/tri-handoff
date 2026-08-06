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
