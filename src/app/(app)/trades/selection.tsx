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
import { deleteRowsAction } from './delete-actions';
import type { TableRow } from './rows';

/**
 * Picking rows out of the trades table and removing them together.
 *
 * One row at a time was never the shape of this job. What a trader wants to delete is a run —
 * a morning entered twice, a symbol they no longer trade, the tail of an account they have
 * stopped reading — and doing that one row and one confirmation at a time is how a cluttered
 * book stays cluttered.
 *
 * The selection is component state rather than the URL, unlike this screen's filters. A filter
 * describes what you are looking at and is worth linking to; a selection is a sentence half
 * spoken, and putting it in the URL would make the back button a way to half-undo a delete
 * that has already happened.
 *
 * It is deliberately scoped to the page. "Select all" means the forty rows in front of you,
 * not the four hundred behind the pager — a control that silently reaches past what is on
 * screen is how someone deletes a year of history meaning to delete a morning of it.
 *
 * Counts are interpolated here rather than handed down as pre-formatted strings, which is why
 * this reaches for `useTranslations` like the dashboard's grid does: the number is client
 * state, and a message with a plural in it has to be built where the number is known.
 */

type SelectionRow = Pick<TableRow, 'key' | 'source'>;

type SelectionState = {
  selected: ReadonlySet<string>;
  toggle: (key: string) => void;
  toggleAll: () => void;
  /** True when every row on the page is picked — the header box's checked state. */
  allPicked: boolean;
  pending: boolean;
  /**
   * Whether the trader has asked to pick rows at all.
   *
   * Off until the button is pressed, and the boxes do not exist before then. A tick box on
   * every row of a table nobody came here to edit reads as something to fill in — it is the
   * loudest control on a screen whose job is to be read, and it is in the first column, where
   * the eye starts. Deleting is a thing you occasionally decide to do, so it is a thing you
   * ask for.
   */
  picking: boolean;
  setPicking: (next: boolean) => void;
};

const Context = createContext<SelectionState | null>(null);

export function TradeSelection({
  rows,
  /** Whether any broker account is connected — decides whether the sync warning is true. */
  brokerConnected,
  children,
}: {
  rows: readonly SelectionRow[];
  brokerConnected: boolean;
  children: ReactNode;
}) {
  const t = useTranslations('trades');
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [picking, setPickingState] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  /*
   * Leaving picking mode drops the selection, and the alternative is worse than untidy.
   *
   * A ticked row whose box is no longer drawn is a row the trader cannot see they have
   * chosen; press the button again later and the action bar returns with rows picked from a
   * decision made minutes ago. Anything still selected has to stay visible or stop existing.
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
   * Narrowed to the rows actually on the page.
   *
   * A selection outlives a re-render that changed what is under it — paging while rows are
   * ticked, or a filter narrowing beneath them — and acting on a key that is no longer visible
   * would delete something the trader can no longer see to reconsider.
   */
  const picked = useMemo(() => {
    const onPage = new Set(rows.map((row) => row.key));
    return [...selected].filter((key) => onPage.has(key));
  }, [rows, selected]);

  const allPicked = rows.length > 0 && picked.length === rows.length;

  const toggleAll = useCallback(() => {
    setSelected(allPicked ? new Set() : new Set(rows.map((row) => row.key)));
  }, [allPicked, rows]);

  const value = useMemo<SelectionState>(
    () => ({ selected, toggle, toggleAll, allPicked, pending, picking, setPicking }),
    [selected, toggle, toggleAll, allPicked, pending, picking, setPicking],
  );

  function remove() {
    if (picked.length === 0) return;

    /*
     * Two sentences, because they answer different questions: how many, and whether they stay
     * gone. The second is only true while something could put them back — a disconnected
     * account has had its credentials cleared and cannot sync, so warning about it there would
     * describe a risk that does not exist.
     */
    const chosen = new Set(picked);
    const fromBroker = rows.some((row) => chosen.has(row.key) && row.source === 'mt5');
    const question = t('delete.confirm', { count: picked.length });
    const full =
      brokerConnected && fromBroker ? `${question}\n\n${t('delete.confirmSynced')}` : question;
    if (!window.confirm(full)) return;

    setError(null);
    startTransition(async () => {
      const result = await deleteRowsAction(picked);
      if (result.error) {
        setError(result.error);
        return;
      }
      // Cleared only on success: a failed delete that unticks everything makes the trader find
      // the same rows again before they can retry.
      clear();
    });
  }

  return (
    <Context.Provider value={value}>
      {children}

      {picked.length > 0 ? (
        <div className="bg-raised border-line sticky bottom-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-4 py-3">
          <span className="text-text text-xs font-semibold">
            {t('delete.selected', { count: picked.length })}
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
                <X size={13} aria-hidden /> {t('delete.clear')}
              </span>
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              className="bg-neg/10 text-neg border-neg/30 hover:bg-neg/20 rounded-[10px] border px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
            >
              <span className="inline-flex items-center gap-1.5">
                <Trash2 size={13} aria-hidden /> {t('delete.delete')}
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
  if (state === null) throw new Error('useSelection must be used inside <TradeSelection>');
  return state;
}

const box = 'accent-brand size-4 shrink-0 cursor-pointer disabled:opacity-60';

/**
 * The button that asks for the boxes, and the same button that puts them away.
 *
 * Everything below renders nothing at all until this is on — not hidden, absent. A column that
 * is merely emptied still holds its width and its padding, so the table would keep a blank
 * gutter down the side reserved for a mode nobody is in.
 */
export function SelectionToggle() {
  const t = useTranslations('trades');
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
        {picking ? t('delete.pickDone') : t('delete.pick')}
      </span>
    </button>
  );
}

/** One row's tick box, labelled with the row so a screen reader says which one it is. */
function RowCheckbox({ label, rowKey }: { label: string; rowKey: string }) {
  const t = useTranslations('trades');
  const { selected, toggle, pending } = useSelection();
  return (
    <input
      type="checkbox"
      checked={selected.has(rowKey)}
      disabled={pending}
      onChange={() => toggle(rowKey)}
      aria-label={t('delete.selectRow', { row: label })}
      className={box}
    />
  );
}

/** The header box: every row on this page, or none of them. */
function SelectAllCheckbox() {
  const t = useTranslations('trades');
  const { allPicked, toggleAll, pending } = useSelection();
  return (
    <input
      type="checkbox"
      checked={allPicked}
      disabled={pending}
      onChange={toggleAll}
      aria-label={t('delete.selectAll')}
      className={box}
    />
  );
}

/*
 * The cells, not just their contents.
 *
 * Each of these renders the wrapper too, so that turning picking off removes the column rather
 * than blanking it — and so the header cell and the body cells can never disagree about
 * whether the column is there, which is the one way a table can end up one cell short of its
 * own header.
 */

/** The header cell over the tick boxes. */
export function SelectAllHeaderCell() {
  const { picking } = useSelection();
  if (!picking) return null;
  return (
    <th className="border-line w-9 border-b px-3.5 py-2.5">
      <SelectAllCheckbox />
    </th>
  );
}

/** A row's cell in the table. */
export function RowCheckboxCell(props: { label: string; rowKey: string }) {
  const { picking } = useSelection();
  if (!picking) return null;
  return (
    <td className="px-3.5 py-2.5">
      <RowCheckbox {...props} />
    </td>
  );
}

/**
 * A row's box in the phone list.
 *
 * Outside the row's link, because a control nested inside an anchor is activated by the tap
 * the anchor also handles — ticking a row would navigate away from the row being ticked. Its
 * own padding rather than the link's, so the target is a finger wide.
 */
export function RowCheckboxSlot(props: { label: string; rowKey: string }) {
  const { picking } = useSelection();
  if (!picking) return null;
  return (
    <span className="flex shrink-0 items-center self-stretch ps-4 pe-1">
      <RowCheckbox {...props} />
    </span>
  );
}
