'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { CalendarRange, Check, ChevronDown } from 'lucide-react';
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
  /*
   * Arriving on a custom range opens the panel — on a wide screen.
   *
   * It exists so a shared link lands on the fields that produced it. Below `lg` that is both
   * unnecessary and in the way: the trigger *is* the range there, so the panel says nothing new,
   * and it is a full-width sheet that opens over whatever the page put under it — on the finance
   * screen, directly over the button for adding an entry.
   *
   * Read once, on mount, rather than watched: this decides an initial state, and a panel that
   * opened or closed itself because a phone was turned sideways is a control moving on its own.
   */
  const wideEnough = () =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;

  const [panel, setPanel] = useState(() => ({ key, open: false, mode: modeOf(current) }));

  useEffect(() => {
    setPanel((prev) => {
      if (prev.key !== key) {
        return { key, open: custom && wideEnough(), mode: modeOf(current) };
      }
      return prev;
    });
  }, [key, custom, current]);

  // The first paint has to agree between the server and the client, so the mount-time open is
  // an effect rather than an initial value.
  useEffect(() => {
    if (custom && wideEnough()) setPanel((prev) => ({ ...prev, open: true }));
    // Once, for the range this mounted on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      active ? 'bg-brand font-bold text-on-brand' : 'text-dim font-medium'
    }`;
  const field =
    'border-line bg-raised text-text min-h-9 w-full rounded-[10px] border px-2.5 py-1.5 text-xs';

  /*
   * What the compact trigger says: the range itself.
   *
   * A preset by its own name, a custom one by its dates. That is the whole idea of the narrow
   * layout — the control reads as the answer rather than as four ways to change it, and the
   * ways to change it are one tap away.
   */
  const activeLabel =
    current.kind === 'dates' || current.kind === 'months'
      ? (summary ?? labels.custom)
      : labels.presets[current.kind];

  return (
    /*
     * Two layouts of one control, and the breakpoint is `lg` rather than `md`.
     *
     * From `lg` the presets are a segmented row with the custom trigger beside them and the
     * range spelled out after that — a shape that needs about four hundred and thirty pixels
     * and has them there.
     *
     * Below it, one button that reads the current range, and a panel with every option in it.
     * `md` was the wrong line to draw: it *is* 768, so a tablet at exactly that width got the
     * wide layout with nothing to spare, tabs cut off on one side and the picker filling the
     * rest.
     */
    <div className="flex w-full min-w-0 flex-wrap items-center gap-2 lg:w-auto lg:justify-end">
      <>
        {/* No label and no icon. The buttons say "maximum", "this month", "last month" and
            name the custom range outright, so a heading in front of them was restating what
            they already read as. The group keeps its `aria-label`, so a screen reader — which
            cannot see that the buttons are a set — is told what they are for. */}
        <form action={applyRangeAction} className="hidden lg:block">
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

        <div ref={anchor} className="relative w-full lg:w-auto">
          <button
            ref={trigger}
            type="button"
            aria-expanded={panel.open}
            aria-haspopup="dialog"
            aria-controls="tri-range-custom"
            onClick={() => setPanel((state) => ({ ...state, open: !state.open }))}
            /*
             * No `aria-label`. One was added here and it overrode the button's own text: on a
             * desktop a screen reader read "Time range: Maximum" off a button that says
             * "Custom range", which is a worse name than the one it replaced and broke every
             * test that finds this control the way a person does. The visible content is the
             * name — the range itself on a phone, the words above `lg` — and `aria-haspopup`
             * already says it opens something.
             */
            className={`tri-tap border-line flex min-h-9 w-full items-center justify-between gap-1.5 rounded-[10px] border px-3 py-1.5 text-[13px] lg:inline-flex lg:w-auto lg:justify-start ${
              custom ? 'bg-brand font-bold text-on-brand' : 'bg-raised text-dim font-medium'
            }`}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <CalendarRange size={14} aria-hidden className="shrink-0" />
              {/* The range below `lg`, the words "custom range" above it — where the segmented
                  row already names the presets and this button is only the other door. */}
              <span
                dir={current.kind === 'dates' ? 'ltr' : undefined}
                className="truncate lg:hidden"
              >
                {activeLabel}
              </span>
              <span className="hidden lg:inline">{labels.custom}</span>
            </span>
            <ChevronDown
              size={13}
              aria-hidden
              className={`shrink-0 transition-transform ${panel.open ? 'rotate-180' : ''}`}
            />
          </button>

          {panel.open ? (
            /*
             * One panel, holding whatever the layout above it does not.
             *
             * From `lg` that is the custom range alone, because the presets are already a row
             * of buttons outside it. Below `lg` the presets come in here too, as full-width
             * rows — which is the point of the narrow layout: one control, and every way to
             * change the range behind it.
             */
            <div
              id="tri-range-custom"
              role="dialog"
              aria-label={labels.title}
              className="tri-sheet border-line bg-surface absolute end-0 top-[calc(100%+6px)] z-30 w-full max-w-[calc(100vw-2rem)] rounded-[14px] border p-3 shadow-xl lg:w-[290px]"
            >
              <form action={applyRangeAction} className="mb-3 flex flex-col gap-1 lg:hidden">
                <Where path={pathname} query={query} />
                {RANGE_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="submit"
                    name="intent"
                    value={presetToken(preset)}
                    aria-pressed={current.kind === preset}
                    className={`tri-tap flex min-h-9 items-center justify-between rounded-[10px] px-3 py-1.5 text-[13px] ${
                      current.kind === preset
                        ? 'bg-brand font-bold text-on-brand'
                        : 'text-text hover:bg-raised font-medium'
                    }`}
                  >
                    {labels.presets[preset]}
                    {current.kind === preset ? <Check size={14} aria-hidden /> : null}
                  </button>
                ))}
              </form>

              {/* The line between "one of these three" and "or say it yourself". */}
              <div className="border-line mb-3 border-t lg:hidden" />

              {/*
                One form, one Apply, two fields.

                Stacked rather than strung out along a row: "from" above "to" is the order the
                range is read in, each endpoint gets its own line and its own label, and the
                card is narrow enough that the eye does not travel. The horizontal version put
                six controls and two Apply buttons across the full width of the page for a
                choice that is one or the other.

                Switching the mode leaves only the two fields that mode needs, which also keeps
                `required` honest: a hidden-but-present date field is one the browser refuses
                to report a validation error on, because it cannot focus it to show the message.
              */}
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
                  className="tri-tap bg-brand min-h-9 w-full rounded-[10px] px-4 py-1.5 text-xs font-bold text-on-brand"
                >
                  {labels.apply}
                </button>
              </form>
            </div>
          ) : null}
        </div>

        {/* What is actually on screen, in the same words the picker offered — so a range
            picked three screens ago is still legible without opening the popover. Wide layouts
            only: below `lg` the trigger itself reads the range, which is the whole point of it.

            `dir="ltr"` for the same reason `Num` sets it: `01/01/2026 – 31/03/2026` is a
            left-to-right run, and inside the Hebrew layout the neutral slashes and dash let the
            endpoints swap places. */}
        {summary ? (
          <span dir="ltr" className="text-dim hidden text-[11px] lg:inline">
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
