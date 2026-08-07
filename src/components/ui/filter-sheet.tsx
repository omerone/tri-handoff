'use client';

import { SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/**
 * The filter controls: a row on a desktop, a sheet behind one button on a phone.
 *
 * Six dropdowns and a search box laid out as a wrapping row cost 296 pixels on a 412 pixel
 * screen — thirty-five per cent of it, spent before the first trade is visible, on a screen
 * whose job is to show trades. Filtering is something a person does occasionally and reading
 * is what they came for, so the occasional thing folds away.
 *
 * **One copy of the children, moved by CSS.** The obvious build renders the controls twice —
 * inline for the desktop, again inside a dialog for the phone — and that means two of every
 * control, each with its own draft state, one of them always stale. Here the wrapper is
 * `display: contents` from `md` up, so it generates no box at all and the controls are direct
 * children of the filter row exactly as they were before this existed; below `md` the same
 * element becomes a sheet fixed to the bottom of the screen.
 *
 * That rules out `<dialog>`, which cannot be a plain block in a flex row, so the parts a
 * modal would have given for free are done by hand below: escape, the backdrop, the scroll
 * lock, and returning focus to the button that opened it.
 */
export function FilterSheet({
  title,
  /** How many filters are on. Shown on the button so a folded filter is never a hidden one. */
  active,
  labels,
  children,
}: {
  title: string;
  active: number;
  labels: { open: string; close: string; done: string };
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const sheetId = useId();
  const sheet = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    // Escape closes, which on a sheet covering the screen is the only way out by keyboard.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);

    /*
     * The page must not scroll under the sheet. Restored from whatever it was rather than set
     * to `''`, so a page that had its own overflow rule keeps it.
     */
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus lands inside rather than staying on a button behind the backdrop.
    sheet.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    // Back to the control that opened it, which is where a keyboard user left off.
    trigger.current?.focus();
  };

  return (
    <>
      {/* The trigger exists only below `md`; above it the controls are simply in the row. */}
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-controls={sheetId}
        className="border-line bg-raised text-text inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] border px-3 text-sm font-semibold md:hidden"
      >
        <SlidersHorizontal size={15} aria-hidden />
        {labels.open}
        {active > 0 ? (
          <span className="bg-brand inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold text-white tabular-nums">
            {active}
          </span>
        ) : null}
      </button>

      {/* Backdrop. Its own element rather than a shadow on the sheet, so a tap outside closes. */}
      {open ? (
        <button
          type="button"
          aria-label={labels.close}
          onClick={close}
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
        />
      ) : null}

      <div
        id={sheetId}
        ref={sheet}
        tabIndex={-1}
        role={open ? 'dialog' : undefined}
        aria-modal={open ? true : undefined}
        aria-label={open ? title : undefined}
        /*
         * `md:` wins in both directions: below it the sheet is hidden until opened, above it
         * `md:contents` drops this wrapper out of the layout entirely, so the controls become
         * direct children of the filter row and wrap exactly as they did before this existed.
         */
        className={`${open ? 'flex' : 'hidden'} border-line bg-surface fixed inset-x-0 bottom-0 z-50 max-h-[85vh] flex-col gap-3 overflow-y-auto rounded-t-2xl border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl md:contents`}
      >
        {/* Sheet furniture, and none of it on a desktop where there is no sheet. */}
        <div className="flex items-center justify-between gap-2 md:hidden">
          <span className="text-text text-sm font-bold">{title}</span>
          <button
            type="button"
            onClick={close}
            aria-label={labels.close}
            className="text-dim hover:text-text -m-2 inline-flex min-h-11 min-w-11 items-center justify-center"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        {children}

        <button
          type="button"
          onClick={close}
          className="bg-brand mt-1 inline-flex min-h-11 items-center justify-center rounded-[10px] px-4 text-sm font-bold text-white md:hidden"
        >
          {labels.done}
        </button>
      </div>
    </>
  );
}
