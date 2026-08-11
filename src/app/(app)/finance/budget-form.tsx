'use client';

import { useActionState, useEffect, useRef } from 'react';
import { Trash2 } from 'lucide-react';
import { useTransition } from 'react';
import { setBudgetAction, deleteBudgetAction, type BudgetFormState } from './budget-actions';

export type BudgetFormLabels = {
  category: string;
  categoryPlaceholder: string;
  amount: string;
  add: string;
  remove: string;
  /** Categories already in use, offered so a budget lands on the same word the ledger uses. */
  options: string[];
};

/**
 * Setting a ceiling, and removing one.
 *
 * The number of budgets is the trader's to decide — they name the categories and they say how
 * many there are — so this is a row that adds one rather than a fixed set of fields. Setting a
 * category that already has a ceiling moves it, which is why there is no separate edit: the
 * form *is* the edit, and typing "food 2500" over "food 2000" is what a person expects to do.
 *
 * The category field offers what the ledger already contains. That is not a convenience: a
 * budget on "Food" while the expenses are filed under "food" is a gauge that reads zero
 * forever, and the suggestion is what stops the two drifting apart.
 */
export function BudgetForm({ owner, labels }: { owner: string; labels: BudgetFormLabels }) {
  const [state, action] = useActionState<BudgetFormState, FormData>(setBudgetAction, {});
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state.error) form.current?.reset();
  }, [state]);

  const field =
    'border-line bg-raised text-text rounded-[10px] border px-2.5 py-2 text-sm w-full';

  return (
    <form ref={form} action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="owner" value={owner} />

      <label className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-none sm:w-44">
        <span className="text-dim text-[11px] font-semibold">{labels.category}</span>
        <input
          name="category"
          list="budget-categories"
          required
          placeholder={labels.categoryPlaceholder}
          className={field}
        />
        <datalist id="budget-categories">
          {labels.options.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      </label>

      <label className="flex w-28 flex-col gap-1">
        <span className="text-dim text-[11px] font-semibold">{labels.amount}</span>
        <input name="amount" required inputMode="decimal" dir="ltr" placeholder="2000" className={field} />
      </label>

      <button
        type="submit"
        className="bg-brand text-on-brand min-h-11 rounded-[10px] px-4 text-sm font-bold sm:min-h-9"
      >
        {labels.add}
      </button>

      {state.error ? <p className="text-neg w-full text-xs">{state.error}</p> : null}
    </form>
  );
}

/** Removing one ceiling. Its own component so the row stays a server component. */
export function BudgetRemove({ id, label }: { id: string; label: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-label={label}
      data-tip={label}
      onClick={() => startTransition(() => deleteBudgetAction(id))}
      className="text-dim hover:text-neg -m-1 p-1 disabled:opacity-40"
    >
      <Trash2 size={13} aria-hidden />
    </button>
  );
}
