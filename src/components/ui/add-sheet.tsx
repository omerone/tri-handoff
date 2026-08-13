'use client';

import { Plus, X } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';

/**
 * An entry form: inline on a wide screen, behind a button on a narrow one.
 *
 * Every screen in this product that records something — a lesson, a holding, a hand-entered
 * trade, a month's income — opens with its form. On a desktop that is right: the form is three
 * or four fields across one row, it costs nothing to leave out, and having it in front of you
 * is the invitation to use it.
 *
 * On a phone the same form is eight stacked fields and a button, which is most of a screen, and
 * it sits *above* the thing the screen is actually for. Reading last month's expenses meant
 * scrolling past the form for adding one, every time. So below `md` the form is a button, and
 * pressing it brings the form up over the page.
 *
 * **CSS decides where the form lives, not JavaScript.** The obvious build — measure the
 * viewport, then render the form in one place or the other — makes the server and the first
 * client render disagree, and the fix for that is rendering it inline first and moving it after
 * mount, which is a flash of the exact layout this exists to avoid. Here the form is in the
 * markup once, `hidden md:block` keeps it out of the way on a phone, and the open state only
 * ever adds the overlay.
 */
export function AddSheet({
  /** The button, and the sheet's heading — "Add a trade", "Add an entry". */
  label,
  /**
   * Open from the first paint.
   *
   * For a form the *page* has already decided to show — arriving on `?edit=…`, where the
   * fields are seeded with a row and the reader pressed something to get here. Without it the
   * phone draws the sheet closed over a form that is ready, and the press reads as a control
   * that did nothing.
   */
  openOnMount = false,
  children,
}: {
  label: string;
  openOnMount?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(openOnMount);
  const sheetId = useId();

  // Escape closes it, and the page behind it does not scroll while it is up — otherwise a
  // flick meant to scroll the form takes the list underneath with it.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={sheetId}
        className="tri-tap bg-brand flex min-h-11 w-full items-center justify-center gap-1.5 rounded-[10px] px-4 py-2 text-sm font-bold text-on-brand md:hidden"
      >
        <Plus size={16} aria-hidden />
        {label}
      </button>

      {/* The dimmer. Its own element rather than a background on the sheet, so a tap anywhere
          off the form closes it — which is the gesture people try first. */}
      {open ? (
        <div
          aria-hidden
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
        />
      ) : null}

      <div
        id={sheetId}
        role={open ? 'dialog' : undefined}
        aria-modal={open ? true : undefined}
        aria-label={open ? label : undefined}
        /*
         * Three states in one element, which is what keeps the form from being written twice.
         *
         * Wide: a plain block, exactly as it was. Narrow and closed: not drawn. Narrow and
         * open: a sheet rising from the bottom edge, capped at most of the screen and
         * scrolling inside itself — the fields have to be reachable with the keyboard up, and
         * a sheet taller than the viewport puts its submit button somewhere nobody can get to.
         */
        className={
          open
            ? 'bg-surface border-line tri-sheet-up fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-[18px] border-t p-4 pb-8 md:static md:z-auto md:max-h-none md:overflow-visible md:rounded-none md:border-0 md:p-0'
            : 'hidden md:block'
        }
      >
        {open ? (
          <div className="mb-3 flex items-center justify-between md:hidden">
            <span className="text-text text-sm font-bold">{label}</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={label}
              className="tri-tap text-dim hover:text-text flex size-8 items-center justify-center rounded-lg"
            >
              <X size={16} aria-hidden />
            </button>
          </div>
        ) : null}

        {/*
          Submitting closes it, and that is not a nicety.
          
          The sheet locks the page's scroll while it is up — otherwise a flick meant for the
          form takes the list underneath with it. Left open after a submit, the lock stayed on
          and the page was stuck: the row the person had just added was under a sheet they had
          to dismiss by hand, on a page that could no longer scroll to show it either way.
          
          `checkValidity` so a form the browser is about to refuse stays put with its own
          message on screen. A server-side rejection still closes the sheet and re-renders its
          message inside it, which is the one case this does not handle well — reopening shows
          it, and no form here rejects anything the browser has not already caught except the
          date-order check on a hand-entered trade.
        */}
        <div
          onSubmitCapture={(event) => {
            if ((event.target as HTMLFormElement).checkValidity?.() !== false) setOpen(false);
          }}
        >
          {children}
        </div>
      </div>
    </>
  );
}
