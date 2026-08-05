'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { applyRangeAction } from '@/app/actions/range';
import { DateField } from '@/components/ui/date-field';
import type { Locale } from '@/i18n/config';
import { isRangedPath } from '@/lib/nav';
import { toIsoDate } from '@/lib/time/format';
import {
  describeRange,
  formatRange,
  parseRange,
  presetToken,
  RANGE_PARAM,
  RANGE_PRESETS,
  resolveRange,
  type RangePreset,
  type TimeRange,
} from '@/lib/time/range';

export type RangeLabels = {
  title: string;
  presets: Record<RangePreset, string>;
  custom: string;
  byMonths: string;
  byDates: string;
  from: string;
  to: string;
  apply: string;
  /** Twelve month names in the reader's language, January first. */
  monthNames: readonly string[];
};

/** The two shapes a custom range can take. Also the `intent` the action reads. */
type Mode = 'months' | 'dates';

const modeOf = (range: TimeRange): Mode => (range.kind === 'dates' ? 'dates' : 'months');

/**
 * The one time control in the product, sitting under the nav on every screen that reads its
 * data through a period.
 *
 * The presets are submit buttons in a plain form posting to a server action, so choosing one
 * is a single request with no client state involved. The custom range is a popover anchored to
 * its button rather than a panel in the flow: this bar lives inside the sticky header, and a
 * panel that expands it pushes every screen down by a row and takes that row back on the next
 * click — the page moving under the reader as a side effect of opening a menu.
 *
 * The picker as a whole is a client component for the three facts the shell around it cannot
 * see — which path it is on, what is in the query string, and therefore which range is actually
 * in force. The shell is a layout, and layouts are not handed `searchParams`; a picker fed only
 * the cookie would sit there reading "Maximum" above a page rendering a shared link's March.
 *
 * So the URL is read here and resolved with the same `parseRange` the server used, which is
 * what keeps the two answers identical rather than merely similar. `now` arrives as a prop for
 * the same reason: `thisMonth` resolved against two different clocks is two different months.
 */
export function RangePicker({
  fallback,
  now,
  locale,
  years,
  labels,
}: {
  /** The cookie's range, used when the URL asks for nothing. */
  fallback: TimeRange;
  /** One instant for both renders of this component, so hydration cannot disagree. */
  now: Date;
  locale: Locale;
  years: readonly number[];
  labels: RangeLabels;
}) {
  const pathname = usePathname();
  const params = useSearchParams();

  const current = parseRange(params.get(RANGE_PARAM), now) ?? fallback;
  const custom = current.kind === 'months' || current.kind === 'dates';
  const key = formatRange(current);

  /*
   * What the popover is doing, remembered against the range it was opened for.
   *
   * This was a `<details open={custom}>`, which has a hole in it: once the user has toggled a
   * native disclosure, the DOM state is theirs and React will not touch it again unless the
   * attribute it renders actually changes. Open the panel, then click "Maximum", and the panel
   * stayed open — a form full of month and date fields standing under a picker that says the
   * range is everything. Resetting on the range key is the documented way to derive state from
   * props, and it closes the popover exactly when the answer above it changed.
   */
  const [panel, setPanel] = useState(() => ({ key, open: custom, mode: modeOf(current) }));

  useEffect(() => {
    setPanel((prev) => {
      if (prev.key !== key) {
        return { key, open: custom, mode: modeOf(current) };
      }
      return prev;
    });
  }, [key, custom, current]);

  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  // What every popover owes the person who opened it: a way out that is not hunting for the
  // button again. Escape puts focus back where it came from; a click elsewhere just dismisses.
  // Native `<select>` lists and the date picker are browser UI rather than nodes in this
  // document, so choosing a month does not count as clicking outside.
  useEffect(() => {
    if (!panel.open) return;

    const dismiss = () => setPanel((state) => ({ ...state, open: false }));
    const onPointerDown = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node)) dismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      dismiss();
      trigger.current?.focus();
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [panel.open]);

  // Long positions are what is open right now and Settings is not data; a control that changes
  // nothing is worse than no control.
  if (!isRangedPath(pathname)) return null;

  const resolved = resolveRange(current, now);
  const summary = describeRange(resolved, locale);

  // The custom fields open on what is already showing. With nothing to show — `max` — they
  // open on the current month, which is the shortest path to the range most people want next.
  const thisMonth = resolveRange({ kind: 'thisMonth' }, now);
  const defaults = {
    from: resolved.fromDate ?? thisMonth.fromDate!,
    to: resolved.toDate ?? thisMonth.toDate!,
  };

  const query = params.toString();
  const group = 'border-line bg-raised flex gap-1 rounded-[10px] border p-[3px]';
  const segment = (active: boolean) =>
    `tri-tap rounded-lg px-3 py-1.5 text-[13px] ${
      active ? 'bg-brand font-bold text-white' : 'text-dim font-medium'
    }`;
  const field =
    'border-line bg-raised text-text min-h-9 w-full rounded-[10px] border px-2.5 py-1.5 text-xs';

  return (
    /*
     * No bar of its own. This used to be a full-width strip under the nav — a third row in a
     * sticky header, spending vertical space on every screen to hold four buttons. It now sits
     * on the nav's row, at the opposite end: tabs where reading starts, dates where it ends.
     *
     * `flex-wrap` on the row above still gives it a line of its own on a narrow phone, where
     * the tabs and these four buttons genuinely do not fit side by side.
     */
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <>
        {/* No label and no icon. The buttons say "maximum", "this month", "last month" and
            name the custom range outright, so a heading in front of them was restating what
            they already read as. The group keeps its `aria-label`, so a screen reader — which
            cannot see that the buttons are a set — is told what they are for. */}
        <form action={applyRangeAction}>
          <Where path={pathname} query={query} />
          <div role="group" aria-label={labels.title} className={`${group} inline-flex`}>
            {RANGE_PRESETS.map((preset) => (
              <button
                key={preset}
                type="submit"
                name="intent"
                value={presetToken(preset)}
                aria-pressed={current.kind === preset}
                className={segment(current.kind === preset)}
              >
                {labels.presets[preset]}
              </button>
            ))}
          </div>
        </form>

        <div ref={anchor} className="relative">
          <button
            ref={trigger}
            type="button"
            aria-expanded={panel.open}
            aria-haspopup="dialog"
            aria-controls="tri-range-custom"
            onClick={() => setPanel((state) => ({ ...state, open: !state.open }))}
            className={`tri-tap border-line inline-flex min-h-9 items-center gap-1.5 rounded-[10px] border px-3 py-1.5 text-[13px] ${
              custom ? 'bg-brand font-bold text-white' : 'bg-raised text-dim font-medium'
            }`}
          >
            {labels.custom}
            <ChevronDown size={13} aria-hidden className={panel.open ? 'rotate-180' : undefined} />
          </button>

          {panel.open ? (
            /*
             * One form, one Apply, two fields.
             *
             * Stacked rather than strung out along a row: "from" above "to" is the order the
             * range is read in, each endpoint gets its own line and its own label, and the card
             * is narrow enough that the eye does not travel. The horizontal version put six
             * controls and two Apply buttons across the full width of the page for a choice
             * that is one or the other.
             *
             * Switching the mode leaves only the two fields that mode needs, which also keeps
             * `required` honest: a hidden-but-present date field is one the browser refuses to
             * report a validation error on, because it cannot focus it to show the message.
             */
            <div
              id="tri-range-custom"
              role="dialog"
              aria-label={labels.custom}
              className="border-line bg-surface absolute end-0 top-[calc(100%+6px)] z-30 w-[290px] max-w-[calc(100vw-2rem)] rounded-[14px] border p-3 shadow-xl"
            >
              <form action={applyRangeAction} className="flex flex-col gap-3">
                <Where path={pathname} query={query} />
                <input type="hidden" name="intent" value={panel.mode} />

                <div role="group" aria-label={labels.custom} className={group}>
                  {(
                    [
                      ['months', labels.byMonths],
                      ['dates', labels.byDates],
                    ] as const
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={panel.mode === mode}
                      onClick={() => setPanel((state) => ({ ...state, mode }))}
                      className={`flex-1 ${segment(panel.mode === mode)}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {panel.mode === 'months' ? (
                  <>
                    <MonthSelect
                      name="fromMonth"
                      legend={labels.from}
                      value={defaults.from}
                      years={years}
                      monthNames={labels.monthNames}
                      className={field}
                    />
                    <MonthSelect
                      name="toMonth"
                      legend={labels.to}
                      value={defaults.to}
                      years={years}
                      monthNames={labels.monthNames}
                      className={field}
                    />
                  </>
                ) : (
                  <>
                    {/* `DateField` rather than a bare `<input type="date">`, for the reason
                        written on that component: the native control renders in the *browser's*
                        locale, so the 2nd of August reads as 08/02 for half of the people who
                        open it. */}
                    <DateField
                      name="fromDate"
                      label={labels.from}
                      defaultValue={toIsoDate(defaults.from)}
                      required
                      className={field}
                    />
                    <DateField
                      name="toDate"
                      label={labels.to}
                      defaultValue={toIsoDate(defaults.to)}
                      required
                      className={field}
                    />
                  </>
                )}

                <button
                  type="submit"
                  className="tri-tap bg-brand min-h-9 w-full rounded-[10px] px-4 py-1.5 text-xs font-bold text-white"
                >
                  {labels.apply}
                </button>
              </form>
            </div>
          ) : null}
        </div>

        {/* What is actually on screen, in the same words the picker offered — so a range
            picked three screens ago is still legible without opening the popover. */}
        {summary ? (
          // `dir="ltr"` for the same reason `Num` sets it: `01/01/2026 – 31/03/2026` is a
          // left-to-right run, and inside the Hebrew layout the neutral slashes and dash let
          // the endpoints swap places.
          <span dir="ltr" className="text-dim hidden text-[11px] md:inline">
            {summary}
          </span>
        ) : null}
      </>
    </div>
  );
}

/**
 * Where to come back to, carried on both forms.
 *
 * The action needs both: the path so it can redirect, and the existing query so that changing
 * the range on a table narrowed to "short crypto" does not also clear the filter.
 */
function Where({ path, query }: { path: string; query: string }) {
  return (
    <>
      <input type="hidden" name="path" value={path} />
      <input type="hidden" name="query" value={query} />
    </>
  );
}

/**
 * A month, as a named month and a four-digit year.
 *
 * Not `<input type="month">`: it is the same trap as `<input type="date">`, rendering in the
 * browser's locale with no way for the page to say otherwise. A month *name* cannot be
 * misread for a year, in either language.
 */
function MonthSelect({
  name,
  legend,
  value,
  years,
  monthNames,
  className,
}: {
  name: string;
  legend: string;
  value: { year: number; month: number };
  years: readonly number[];
  monthNames: readonly string[];
  className: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-dim text-[11px] font-semibold">{legend}</span>
      <span className="flex gap-2">
        {/* The month name is the longer of the two and gets the room for it: "September" in a
            box sized for "2026" is a box that says "Septem…". */}
        <select
          name={`${name}Month`}
          defaultValue={value.month}
          aria-label={legend}
          className={`${className} flex-[3] min-w-0`}
        >
          {monthNames.map((label, index) => (
            <option key={label} value={index + 1}>
              {label}
            </option>
          ))}
        </select>
        <select
          name={`${name}Year`}
          defaultValue={value.year}
          aria-label={legend}
          className={`${className} flex-[2] min-w-0`}
        >
          {years.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}
