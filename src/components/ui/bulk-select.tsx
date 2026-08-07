'use client';

import { CheckSquare, Trash2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from 'react';

/**
 * Picking rows out of a list and removing them together.
 *
 * One row at a time was never the shape of this job. What a person wants to delete is a run — a
 * month entered twice, a topic they no longer study, the tail of a book they have stopped
 * reading — and doing that one row and one confirmation at a time is how a cluttered list stays
 * cluttered.
 *
 * This is the trades table's selection, lifted out of it. Four screens want the same thing and
 * the differences between them are the row keys and which server action does the deleting, so
 * those are the parameters and everything else is here: what "select all" means, when the boxes
 * exist, what leaving the mode does to a half-made choice, and what the bar at the bottom says.
 *
 * **The boxes do not exist until they are asked for.** A tick box on every row of a list nobody
 * came to edit is the loudest control on the screen, in the first column where the eye starts,
 * and the only thing it does is destructive. The cells render themselves rather than only their
 * contents, so turning the mode off removes the column instead of leaving a blank gutter.
 *
 * **"Select all" means what is in front of you.** A control that silently reaches past the rows
 * on screen is how somebody deletes a year meaning to delete a month.
 *
 * The selection is component state rather than the URL, unlike a filter: a filter describes what
 * you are looking at and is worth linking to, while a selection is a sentence half spoken, and
 * putting it in the URL would make the back button a way to half-undo a delete that has already
 * happened.
 */

type SelectionState = {
  selected: ReadonlySet<string>;
  toggle: (key: string) => void;
  toggleAll: () => void;
  /** True when every row on the page is picked — the header box's checked state. */
  allPicked: boolean;
  pending: boolean;
  picking: boolean;
  setPicking: (next: boolean) => void;
};

const Context = createContext<SelectionState | null>(null);

export function BulkSelect({
  keys,
  onDelete,
  /** An extra sentence in the confirmation, when there is one worth adding. */
  warning,
  children,
}: {
  /** Every row currently on screen, in the order they are drawn. */
  keys: readonly string[];
  /** Returns an error message to show, or nothing when the rows went. */
  onDelete: (keys: string[]) => Promise<{ error?: string } | void>;
  warning?: string;
  children: ReactNode;
}) {
  const t = useTranslations('bulk');
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [picking, setPickingState] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  /*
   * Leaving picking mode drops the selection, and the alternative is worse than untidy.
   *
   * A ticked row whose box is no longer drawn is a row the person cannot see they have chosen;
   * press the button again later and the action bar returns armed with a decision made minutes
   * ago. Anything still selected has to stay visible or stop existing.
   */
  const setPicking = useCallback((next: boolean) => {
    setPickingState(next);
    if (!next) setSelected(new Set());
  }, []);

  const toggle = useCallback((key: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  /*
   * Narrowed to the rows actually on screen.
   *
   * A selection outlives a re-render that changed what is under it — paging while rows are
   * ticked, or a filter narrowing beneath them — and acting on a key that is no longer visible
   * would delete something the person can no longer see to reconsider.
   */
  const picked = useMemo(() => {
    const onPage = new Set(keys);
    return [...selected].filter((key) => onPage.has(key));
  }, [keys, selected]);

  const allPicked = keys.length > 0 && picked.length === keys.length;

  const toggleAll = useCallback(() => {
    setSelected(allPicked ? new Set() : new Set(keys));
  }, [allPicked, keys]);

  const value = useMemo<SelectionState>(
    () => ({ selected, toggle, toggleAll, allPicked, pending, picking, setPicking }),
    [selected, toggle, toggleAll, allPicked, pending, picking, setPicking],
  );

  function remove() {
    if (picked.length === 0) return;

    const question = t('confirm', { count: picked.length });
    if (!window.confirm(warning ? `${question}\n\n${warning}` : question)) return;

    setError(null);
    startTransition(async () => {
      const result = await onDelete(picked);
      if (result && result.error) {
        setError(result.error);
        return;
      }
      // Cleared only on success: a failed delete that unticks everything makes the person find
      // the same rows again before they can retry.
      clear();
      setPicking(false);
    });
  }

  return (
    <Context.Provider value={value}>
      {children}

      {picked.length > 0 ? (
        <div
          data-bulk-bar=""
          className="bg-raised border-line sticky bottom-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-4 py-3"
        >
          <span className="text-text text-xs font-semibold">
            {t('selected', { count: picked.length })}
          </span>

          {error ? <span className="text-neg text-xs">{error}</span> : null}

          <span className="ms-auto flex items-center gap-2">
            <button
              type="button"
              onClick={clear}
              disabled={pending}
              className="border-line text-dim hover:text-text rounded-[10px] border px-3 py-1.5 text-xs disabled:opacity-60"
            >
              <span className="inline-flex items-center gap-1.5">
                <X size={13} aria-hidden /> {t('clear')}
              </span>
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              className="bg-neg/10 text-neg border-neg/30 hover:bg-neg/20 rounded-[10px] border px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
            >
              <span className="inline-flex items-center gap-1.5">
                <Trash2 size={13} aria-hidden /> {t('delete')}
              </span>
            </button>
          </span>
        </div>
      ) : null}
    </Context.Provider>
  );
}

function useSelection(): SelectionState {
  const state = useContext(Context);
  if (state === null) throw new Error('useSelection must be used inside <BulkSelect>');
  return state;
}

const box = 'accent-brand size-4 shrink-0 cursor-pointer disabled:opacity-60';

/*
 * `data-bulk-select` on every one of these, because "a checkbox inside main" is not what they
 * are. The finance screen's entry form has a "repeats every month" box and the learning form
 * will grow one; a test that counted tick boxes counted those too and reported the page as
 * arriving in selection mode. The marker says which boxes are the selection's.
 */

/** The button that asks for the boxes, and the same button that puts them away. */
export function BulkSelectToggle() {
  const t = useTranslations('bulk');
  const { picking, setPicking, pending } = useSelection();
  return (
    <button
      type="button"
      onClick={() => setPicking(!picking)}
      disabled={pending}
      aria-pressed={picking}
      className={`rounded-[10px] border px-3 py-1.5 text-xs disabled:opacity-60 ${
        picking
          ? 'border-brand/40 bg-brand/10 text-brand font-semibold'
          : 'border-line text-dim hover:text-text'
      }`}
    >
      <span className="inline-flex items-center gap-1.5">
        {picking ? <X size={13} aria-hidden /> : <CheckSquare size={13} aria-hidden />}
        {picking ? t('done') : t('pick')}
      </span>
    </button>
  );
}

/** Every row on screen, or none of them. Renders nothing until the mode is on. */
export function BulkSelectAll({ className = '' }: { className?: string }) {
  const t = useTranslations('bulk');
  const { allPicked, toggleAll, pending, picking } = useSelection();
  if (!picking) return null;
  return (
    <span className={`flex shrink-0 items-center ${className}`}>
      <input
        data-bulk-select=""
        type="checkbox"
        checked={allPicked}
        disabled={pending}
        onChange={toggleAll}
        aria-label={t('selectAll')}
        className={box}
      />
    </span>
  );
}

/*
 * The table variants, which render their own cell.
 *
 * A `<td>` that is merely emptied still holds its padding, so a table would keep a blank
 * gutter down the side for a mode nobody is in — and a header cell and its body cells that
 * decide separately whether they exist is how a table ends up one cell short of its own
 * header. Both decisions are made here, from one piece of state.
 */

/**
 * The header cell over the tick boxes — a spacer, not a control.
 *
 * "Select all" lives beside the button that turned the mode on, not in here. `tri-stack` clips
 * `thead` to a one-pixel box on a phone, where these tables become stacked cards, so a box in
 * the header is present for a screen reader and unreachable for a thumb. The cell still has to
 * exist, or the header comes out one column short of the rows under it.
 */
export function BulkSelectHeaderCell() {
  const { picking } = useSelection();
  if (!picking) return null;
  return <th className="border-line w-9 border-b px-3 py-2.5" />;
}

/** A row's cell in a table. */
export function BulkSelectCell({ rowKey, label }: { rowKey: string; label: string }) {
  const t = useTranslations('bulk');
  const { selected, toggle, pending, picking } = useSelection();
  if (!picking) return null;
  return (
    <td className="px-3 py-2.5">
      <input
        data-bulk-select=""
        type="checkbox"
        checked={selected.has(rowKey)}
        disabled={pending}
        onChange={() => toggle(rowKey)}
        aria-label={t('selectRow', { row: label })}
        className={box}
      />
    </td>
  );
}

/** One row's box, labelled with the row so a screen reader says which one it is. */
export function BulkSelectRow({
  rowKey,
  label,
  className = '',
}: {
  rowKey: string;
  label: string;
  className?: string;
}) {
  const t = useTranslations('bulk');
  const { selected, toggle, pending, picking } = useSelection();
  if (!picking) return null;
  return (
    <span className={`flex shrink-0 items-center ${className}`}>
      <input
        data-bulk-select=""
        type="checkbox"
        checked={selected.has(rowKey)}
        disabled={pending}
        onChange={() => toggle(rowKey)}
        aria-label={t('selectRow', { row: label })}
        className={box}
      />
    </span>
  );
}
