import 'server-only';
import { cookies } from 'next/headers';
import { BROTHER_COOKIE, parseBrother, type Brother } from '@/lib/household';

/**
 * Which brother the header switch is resting on, for any server component that filters by it.
 *
 * The same shape as `currentResolvedRange`: the cookie is the only store, and an absent or
 * unrecognisable value falls back to the first brother — this value survives deployments
 * inside people's browsers, and with no merged view to degrade to, a deterministic somebody
 * beats an error. The first visit simply opens on יוני, exactly as if he had been chosen.
 */
export async function currentBrother(): Promise<Brother> {
  return parseBrother((await cookies()).get(BROTHER_COOKIE)?.value);
}
