import 'server-only';
import { cookies } from 'next/headers';
import {
  DEFAULT_RANGE,
  parseRange,
  resolveRange,
  type ResolvedRange,
  type TimeRange,
} from '@/lib/time/range';
import { RANGE_COOKIE } from './cookies';

/**
 * The range this request is being read through.
 *
 * Two sources, in this order:
 *
 * 1. **The query string.** A link someone shares, or a bookmark, has to show what it says —
 *    the recipient's own cookie must not quietly redirect them to a different month.
 * 2. **The cookie.** The picker writes it, and it is what carries the range from one screen to
 *    the next: the nav is plain `<Link href="/trades">` with no query string, and threading a
 *    parameter through every link in the product would mean every future link remembering to.
 *
 * A parameter that parses to nothing falls through to the cookie rather than to the default,
 * so a truncated URL is not silently louder than the choice the user actually made.
 */
export async function currentRange(param?: string): Promise<TimeRange> {
  const fromUrl = parseRange(param);
  if (fromUrl) return fromUrl;

  const cookie = (await cookies()).get(RANGE_COOKIE)?.value;
  return parseRange(cookie) ?? DEFAULT_RANGE;
}

/** The same, resolved to instants. What page code almost always wants. */
export async function currentResolvedRange(param?: string): Promise<ResolvedRange> {
  return resolveRange(await currentRange(param));
}
