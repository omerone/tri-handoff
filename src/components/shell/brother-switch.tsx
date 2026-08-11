'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { applyBrotherAction } from '@/app/actions/brother';
import { HOUSEHOLD, type Brother } from '@/lib/household';

export type BrotherSwitchLabels = {
  /** The group's name for a screen reader, and the tooltip's subject. */
  title: string;
  /** Said over the switch on screens whose data is joint, so a pressed name that changes
   * nothing there reads as "this screen is shared" rather than as a broken control. */
  shared: string;
};

/**
 * Screens whose data belongs to one brother or the other.
 *
 * Everything else — the trades, the analytics, the calendar, the long-term book — is genuinely
 * joint, which is the reason the product is one login. The switch stays visible there so the
 * chosen position is never a mystery, but it is dimmed and captioned: a filter that quietly
 * did nothing on those screens would read as data loss the first time somebody noticed.
 */
const OWNED_PATHS = ['/finance', '/learning'];

/**
 * The brother switch: whose money and whose hours the owned screens are showing.
 *
 * One control in the header rather than a filter per screen, because the question it answers —
 * "whose numbers am I looking at?" — is the same question everywhere it applies, and two
 * screens each with their own answer is how the finance page ends up on one brother while the
 * study ledger silently shows the other.
 *
 * The names are not translated. They are names; they read the same in either locale.
 */
export function BrotherSwitch({
  current,
  labels,
}: {
  /** The cookie's position, resolved on the server so the first paint agrees with it. */
  current: Brother;
  labels: BrotherSwitchLabels;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const owned = OWNED_PATHS.some((path) => pathname.startsWith(path));

  /*
   * Two positions and no third. There was briefly a "both" that merged the ledgers; the
   * brothers asked for their money apart, and a merged view of two private budgets is the
   * exact thing they were separating. The switch always rests on somebody.
   */
  const positions = HOUSEHOLD.map((name) => ({ value: name as Brother, label: name }));

  return (
    <form
      action={applyBrotherAction}
      data-tip={owned ? undefined : labels.shared}
      className={owned ? undefined : 'opacity-55'}
    >
      {/* Where to come back to — the same screen, same query, new position. */}
      <input type="hidden" name="path" value={pathname} />
      <input type="hidden" name="query" value={params.toString()} />

      <div
        role="group"
        aria-label={labels.title}
        className="border-line bg-raised inline-flex rounded-full border p-0.5"
      >
        {positions.map((position) => {
          const active = current === position.value;
          return (
            <button
              key={position.value}
              type="submit"
              name="brother"
              value={position.value}
              aria-pressed={active}
              className={`tri-tap min-h-7 rounded-full px-2.5 text-xs whitespace-nowrap ${
                active ? 'bg-brand text-on-brand font-bold' : 'text-dim hover:text-text font-medium'
              }`}
            >
              {position.label}
            </button>
          );
        })}
      </div>
    </form>
  );
}
