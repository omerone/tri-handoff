'use client';

import { Trash2 } from 'lucide-react';
import { deleteManualTradeAction } from './manual-trade-actions';

/**
 * Removing a trade the trader typed in.
 *
 * A client component only because of the confirm — the same shape the holdings row uses, so
 * the two destructive controls on this screen behave identically. Deleting is genuinely
 * destructive here: it takes the journal note, the rating and the exit answers with it, and
 * there is no broker to re-import the row from.
 *
 * It can only ever remove a manual trade. `deleteManualTradeAction` puts the ticket predicate
 * in the `where` clause, so an id belonging to a synced trade matches nothing.
 */
export function DeleteTradeButton({
  id,
  label,
  confirm,
}: {
  id: string;
  label: string;
  confirm: string;
}) {
  return (
    <form action={deleteManualTradeAction} className="inline-flex">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        aria-label={label}
        data-tip={label}
        onClick={(event) => {
          if (!window.confirm(confirm)) event.preventDefault();
        }}
        className="text-dim/60 hover:text-neg inline-flex p-1"
      >
        <Trash2 size={14} aria-hidden />
      </button>
    </form>
  );
}
