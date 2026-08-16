import 'server-only';
import { cookies } from 'next/headers';
import { MEMBER_COOKIE, resolveMember, type MemberFilter } from '@/lib/household';

/**
 * Which member the header switch is resting on, for the household this request belongs to.
 *
 * Takes the household rather than reaching for it, because the tenant is already on the
 * session every caller holds — and a reader that resolved the tenant itself would be a second
 * opinion about whose request this is. Null for a single-person household: no switch exists,
 * so no position does either.
 */
export async function currentMember(household: readonly string[]): Promise<MemberFilter> {
  return resolveMember(household, (await cookies()).get(MEMBER_COOKIE)?.value);
}
