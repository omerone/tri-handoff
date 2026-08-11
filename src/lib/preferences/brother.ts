import 'server-only';
import { cookies } from 'next/headers';
import { BROTHER_COOKIE, parseBrother, type Brother } from '@/lib/household';

/**
 * Which brother the header switch is resting on, for any server component that filters by it.
 *
 * The same shape as `currentResolvedRange`: the cookie is the only store, and an absent or
 * unrecognisable value is the first brother rather than an error — this value survives deployments inside
 * people's browsers, and the safe degradation is showing everything.
 */
export async function currentBrother(): Promise<Brother> {
  return parseBrother((await cookies()).get(BROTHER_COOKIE)?.value);
}
