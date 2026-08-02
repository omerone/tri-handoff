'use client';

import { useId, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { displayToIso, isoToDisplay } from '@/lib/time/format';

/**
 * A date field that reads `dd/mm/yyyy`, everywhere, for everyone.
 *
 * `<input type="date">` renders in the *browser's* locale, and nothing on the page can change
 * that: the `lang` attribute is ignored — verified in Chrome against `he-IL`, `en-GB` and
 * `de-DE`, all four of which rendered the 2nd of August as `08/02/2026`. So a trader in
 * Israel using an English-language browser was being shown American order in a Hebrew form,
 * with no indication which number was the month.
 *
 * The visible control is therefore an ordinary text field that this product formats. The
 * native picker is kept — it is genuinely the best way to choose a date on a phone — behind
 * the calendar button, which opens a hidden `type="date"` and takes its value back.
 *
 * The form still submits `yyyy-mm-dd` under the original field name, so nothing downstream
 * knows this changed.
 */
export function DateField({
  name,
  defaultValue,
  label,
  required,
  className = '',
}: {
  name: string;
  /** `yyyy-mm-dd`, as the server expects it back. */
  defaultValue: string;
  label: string;
  required?: boolean;
  className?: string;
}) {
  const [text, setText] = useState(() => isoToDisplay(defaultValue));
  const picker = useRef<HTMLInputElement>(null);
  const describedBy = useId();

  const iso = displayToIso(text);
  // Empty is "not filled in yet", which `required` reports in the browser's own words.
  // A non-empty value that does not parse is the user's typo, and is worth saying out loud.
  const invalid = text.trim() !== '' && iso === '';

  return (
    <label className="flex flex-col gap-1">
      <span className="text-dim text-[11px] font-semibold">{label}</span>

      <span className="relative inline-flex items-center">
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          dir="ltr"
          placeholder="dd/mm/yyyy"
          aria-label={label}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          value={text}
          onChange={(event) => setText(event.target.value)}
          // Physical `pr`, not logical `pe`. The field is `dir="ltr"` so the date reads
          // correctly, which makes its logical end the *right*; the button below sits at the
          // wrapper's logical end, which inside the Hebrew layout is the *left*. Reserving
          // space on one side and drawing the icon on the other is what put the calendar on
          // top of the "0" in "02/08/2026". Both are physical now, so they cannot disagree.
          className={`${className} pr-9`}
        />

        {/* The value the rest of the app sees. Kept in sync rather than parsed on the server,
            so an unparseable field submits nothing and trips `required` instead of silently
            posting today's date. */}
        <input type="hidden" name={name} value={iso} />
        {required ? (
          // `required` cannot live on the hidden input — the browser refuses to report a
          // validation error on a field it cannot focus. This mirrors it onto the visible one.
          <input
            type="text"
            required
            tabIndex={-1}
            aria-hidden
            value={iso}
            onChange={() => {}}
            className="pointer-events-none absolute h-px w-px opacity-0"
          />
        ) : null}

        <button
          type="button"
          onClick={() => picker.current?.showPicker?.()}
          aria-label={label}
          className="text-dim hover:text-text absolute right-1 inline-flex p-1.5"
        >
          <CalendarDays size={15} aria-hidden />
        </button>

        <input
          ref={picker}
          type="date"
          tabIndex={-1}
          aria-hidden
          value={iso}
          onChange={(event) => setText(isoToDisplay(event.target.value))}
          className="pointer-events-none absolute right-1 h-px w-px opacity-0"
        />
      </span>

      <span id={describedBy} className="sr-only">
        dd/mm/yyyy
      </span>
    </label>
  );
}
