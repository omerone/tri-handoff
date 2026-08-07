'use client';

import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

/**
 * A filter that takes several answers at once.
 *
 * It replaces a `<select>`, and the reason is that the question was never single-answer. "How
 * did crypto and indices do" is one question about two asset classes, and a dropdown that
 * takes one forced it to be asked twice and the numbers added up by hand — which the summary
 * bar exists to do and could not, because it only ever saw one of the two.
 *
 * Not a `<select multiple>`, which renders as a scrolling list box on a desktop and as
 * something close to unusable on a phone, and which needs a modifier key to pick a second
 * value that no phone has. This is a button and a panel of ordinary checkboxes: tapping is
 * the whole interaction, on either device.
 *
 * Nothing is applied until the panel closes. The alternative — a navigation per tick — turns
 * choosing three classes into three page loads, each of them re-rendering the table underneath
 * the panel the trader is still reading, and leaves the back button holding two states nobody
 * meant to visit.
 */
export function MultiFilter({
  name,
  values,
  options,
  empty,
  summary,
  onApply,
  disabled = false,
}: {
  /** The label above the button, and what a screen reader calls the whole control. */
  name: string;
  values: readonly string[];
  options: readonly (readonly [string, string])[];
  /** What the button says when nothing is chosen — "All". */
  empty: string;
  /** How the button describes several, given the count. */
  summary: (count: number) => string;
  onApply: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<readonly string[]>(values);
  const box = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // The URL is the source of truth; the draft only exists while the panel is open. Re-syncing
  // on every change keeps a browser Back from leaving the panel showing the previous answer.
  useEffect(() => setDraft(values), [values]);

  /*
   * Applied on close, once, whichever way the panel was closed.
   *
   * Kept in a ref so the listener below does not have to be rebuilt every time a box is
   * ticked — and, more importantly, so it always reads the latest draft rather than the one
   * captured when the listener was attached.
   */
  const commit = useRef<() => void>(() => {});
  commit.current = () => {
    setOpen(false);
    const changed =
      draft.length !== values.length || draft.some((value) => !values.includes(value));
    if (changed) onApply([...draft]);
  };

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) commit.current();
    };
    const onKey = (event: KeyboardEvent) => {
      // Escape abandons the draft; Enter is the same as clicking away.
      if (event.key === 'Escape') setOpen(false);
      if (event.key === 'Enter') commit.current();
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = (key: string) =>
    setDraft((current) =>
      current.includes(key) ? current.filter((value) => value !== key) : [...current, key],
    );

  const label =
    values.length === 0
      ? empty
      : values.length === 1
        ? (options.find(([key]) => key === values[0])?.[1] ?? empty)
        : summary(values.length);

  return (
    <div className="relative flex min-w-0 flex-col gap-1" ref={box}>
      <span className="text-dim text-[10px] leading-none">{name}</span>
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${name}: ${label}`}
        onClick={() => (open ? commit.current() : setOpen(true))}
        className={`border-line bg-raised text-text flex min-h-9 w-full items-center justify-between gap-1.5 rounded-[10px] border px-2.5 py-1.5 text-xs disabled:opacity-60 ${
          values.length > 0 ? 'border-brand/40 text-brand font-semibold' : ''
        }`}
      >
        <span className="truncate">{label}</span>
        <ChevronDown size={13} aria-hidden className="shrink-0 opacity-60" />
      </button>

      {open ? (
        <div
          id={panelId}
          role="group"
          aria-label={name}
          /*
            `z-30` and absolute: the panel has to sit over the table below it, and the filter
            bar is a flex row whose height must not grow when one of its children opens — the
            summary figures beside it would jump down the page every time a filter was pressed.
          */
          className="border-line bg-raised absolute top-full z-30 mt-1 max-h-64 min-w-full overflow-auto rounded-[12px] border py-1 shadow-xl"
        >
          {/* Clearing is part of the same panel, so undoing a filter is where making it was. */}
          <button
            type="button"
            onClick={() => setDraft([])}
            className="hover:bg-surface text-dim flex w-full items-center gap-2 px-3 py-1.5 text-start text-xs"
          >
            <span className="size-3.5 shrink-0" aria-hidden />
            {empty}
          </button>

          {options.map(([key, text]) => {
            const picked = draft.includes(key);
            return (
              <label
                key={key}
                className="hover:bg-surface text-text flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs whitespace-nowrap"
              >
                <input
                  type="checkbox"
                  checked={picked}
                  onChange={() => toggle(key)}
                  className="sr-only"
                />
                {/* Drawn rather than a native box, so the tick lines up with the row's text
                    at this size on every platform instead of sitting a pixel high on one. */}
                <span
                  aria-hidden
                  className={`flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border ${
                    picked ? 'border-brand bg-brand text-white' : 'border-line'
                  }`}
                >
                  {picked ? <Check size={10} strokeWidth={3} /> : null}
                </span>
                {text}
              </label>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
