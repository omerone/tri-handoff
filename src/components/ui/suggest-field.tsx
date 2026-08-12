'use client';

import { useEffect, useId, useRef, useState } from 'react';

/**
 * A text field that suggests what has been typed before, drawn by us.
 *
 * Every one of these was a `<datalist>`, which is the right *idea* — free text with the common
 * answers one keystroke away — and a control the browser draws itself. Nothing about it can be
 * styled: not the white panel, not the type, not which side it opens on. On a dark screen in
 * Hebrew it arrived as a tall white box in a serif face, and it was the only part of the
 * product that did not look like the product.
 *
 * So the panel is ours and the contract is unchanged: the field is still free text, the
 * suggestions are still only suggestions, and what the form submits is still whatever the
 * input holds. Nothing downstream of it knows the difference.
 *
 * **The input stays uncontrolled.** Two forms here call `form.reset()` after a successful
 * submit, and React state would survive that reset and leave the last answer sitting in a
 * field the person believes they cleared. Filtering reads the value on the way past instead,
 * and picking a suggestion writes it back through the ref.
 */
export function SuggestField({
  name,
  options,
  className = '',
  boxClassName = '',
  defaultValue,
  placeholder,
  required,
  maxLength,
  id,
  dir,
  /**
   * Comma-separated field: a pick replaces the segment being typed rather than the whole
   * value, and the filter reads that segment. Journal tags are one field holding several
   * answers, and replacing all of them on the first pick loses the rest.
   */
  multiple = false,
}: {
  name: string;
  options: readonly string[];
  className?: string;
  boxClassName?: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
  id?: string;
  dir?: 'ltr' | 'rtl';
  multiple?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  /* Set by a pick, read by the click that the surrounding <label> forwards to the input
     immediately afterwards — without it, choosing an option reopens the list. */
  const justPicked = useRef(false);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const listId = useId();

  /** The part being typed: the whole value, or the segment after the last comma. */
  const segmentOf = (value: string) => (multiple ? (value.split(',').pop() ?? '') : value);

  const fold = (value: string) => value.trim().toLowerCase();
  const needle = fold(segmentOf(query));
  const matches = needle
    ? options.filter((option) => fold(option).includes(needle))
    : [...options];

  // A pointer down anywhere else puts it away — on the way down, before whatever was pressed
  // underneath does its own thing. The same gesture the currency menu closes on.
  useEffect(() => {
    if (!open) return;
    const onOutside = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onOutside);
    return () => document.removeEventListener('pointerdown', onOutside);
  }, [open]);

  const show = (from: string) => {
    setQuery(from);
    setActive(-1);
    setOpen(true);
  };

  const pick = (option: string) => {
    const field = input.current;
    if (!field) return;

    if (multiple) {
      const parts = field.value.split(',');
      parts[parts.length - 1] = ` ${option}`;
      // Trailing separator, so the next tag can be typed straight after the pick.
      field.value = `${parts.join(',').trim()}, `;
    } else {
      field.value = option;
    }

    justPicked.current = true;
    setOpen(false);
    setActive(-1);
    field.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) return show(event.currentTarget.value);
      if (matches.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((was) => (was + step + matches.length) % matches.length);
      return;
    }

    if (event.key === 'Enter' && open && active >= 0 && matches[active]) {
      // Before the form hears it: the first Enter accepts the highlighted suggestion, it
      // does not submit a row the person has not finished writing.
      event.preventDefault();
      pick(matches[active]);
      return;
    }

    if (event.key === 'Escape' && open) {
      // Stopped here, or the sheet this form sits in on a phone closes with it.
      event.stopPropagation();
      setOpen(false);
      setActive(-1);
    }
  };

  return (
    <div ref={box} className={`relative ${boxClassName}`}>
      <input
        ref={input}
        id={id}
        name={name}
        dir={dir}
        required={required}
        maxLength={maxLength}
        placeholder={placeholder}
        defaultValue={defaultValue}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        className={className}
        onChange={(event) => show(event.currentTarget.value)}
        onClick={(event) => {
          if (justPicked.current) {
            justPicked.current = false;
            return;
          }
          if (!open) show(event.currentTarget.value);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
      />

      {/* Closed when nothing matches: free text is a legitimate answer, and an empty panel
          over the field says "no" to something the field is perfectly happy to accept. */}
      {open && matches.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          /* At least as wide as the field, growing to fit the longest name on a narrow one —
             a category called "מזון ומסעדות" in a 9rem box is otherwise three wrapped lines.
             Anchored to the field's start edge, which is the right of it in Hebrew. */
          className="border-line bg-surface absolute top-full start-0 z-50 mt-1.5 flex max-h-56 w-max min-w-full max-w-[18rem] flex-col gap-0.5 overflow-y-auto rounded-[12px] border p-1 shadow-2xl"
        >
          {matches.map((option, index) => (
            <li key={option}>
              <button
                id={`${listId}-${index}`}
                type="button"
                role="option"
                aria-selected={index === active}
                tabIndex={-1}
                /* Picked on the way down, so the field never loses focus to the panel and
                   the blur that would close it never happens. */
                onPointerDown={(event) => {
                  event.preventDefault();
                  pick(option);
                }}
                onMouseEnter={() => setActive(index)}
                className={`w-full rounded-[8px] px-2.5 py-1.5 text-start text-[13px] ${
                  index === active
                    ? 'bg-brand text-on-brand font-bold'
                    : 'text-dim hover:text-text font-medium'
                }`}
              >
                {option}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
