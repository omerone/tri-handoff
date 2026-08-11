'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { Check, Pencil, Trash2, X } from 'lucide-react';
import {
  setBudgetAction,
  deleteBudgetAction,
  editBudgetAction,
  type BudgetFormState,
} from './budget-actions';

export type BudgetFormLabels = {
  category: string;
  categoryPlaceholder: string;
  amount: string;
  currency: string;
  add: string;
  /** Categories already in use, offered so a budget lands on the same word the ledger uses. */
  options: string[];
  /** The currencies a ceiling may be written in, with the symbol each one prints. */
  currencies: { code: string; label: string }[];
  /** Which one to offer first — whatever the reader is already looking at figures in. */
  defaultCurrency: string;
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

      {/*
        Beside the figure rather than derived from the header.

        The header's currency is how the book is being *read* right now and it can be changed
        on a whim; what a ceiling is denominated in is part of the ceiling. Reading in dollars
        for an afternoon must not turn ₪2,000 a month into $2,000 a month. It opens on the
        header's currency because that is what the person is looking at, and then it stays
        with the budget.
      */}
      <label className="flex w-24 flex-col gap-1">
        <span className="text-dim text-[11px] font-semibold">{labels.currency}</span>
        <select name="currency" defaultValue={labels.defaultCurrency} className={field}>
          {labels.currencies.map((currency) => (
            <option key={currency.code} value={currency.code}>
              {currency.label}
            </option>
          ))}
        </select>
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

export type BudgetControlLabels = {
  /** "₪740 used" — what the tile says when it is not being edited. */
  spent: string;
  /** The symbol beside the field, so the figure being typed has a unit on it. */
  symbol: string;
  edit: string;
  remove: string;
  save: string;
  cancel: string;
  /** The field's own name, for the reader who cannot see which tile it belongs to. */
  amount: string;
};

/**
 * The line under one dial: what has been spent, and the two things you can do about it.
 *
 * Editing happens in place rather than in the form at the bottom of the card. The form writes
 * a budget by *category*, and using it to change one means retyping the category exactly —
 * which is not an edit so much as an invitation to create a second ceiling next to the first,
 * with the spending split between them and both dials wrong. Here the row's id is what moves,
 * so the only thing a person can change is the number they came to change.
 *
 * The figure in the field is the monthly ceiling, not the scaled one on the dial above it: on
 * a three-month window those are different numbers, and saving back what the dial showed would
 * triple the allowance every time somebody opened the editor and pressed save.
 */
export function BudgetControls({
  id,
  monthlyAmount,
  labels,
}: {
  id: string;
  monthlyAmount: number;
  labels: BudgetControlLabels;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const icon =
    'tri-tap text-dim flex size-7 items-center justify-center rounded-lg disabled:opacity-40';

  if (editing) {
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const amount = String(new FormData(event.currentTarget).get('amount') ?? '');
          startTransition(async () => {
            const message = await editBudgetAction(id, amount);
            setError(message);
            // Left open on a refusal, so the number that was typed is still there to correct.
            if (!message) setEditing(false);
          });
        }}
        className="flex flex-col items-center gap-1"
      >
        <div className="flex items-center gap-1">
          <span className="text-dim text-xs" aria-hidden>
            {labels.symbol}
          </span>
          <input
            name="amount"
            required
            autoFocus
            inputMode="decimal"
            dir="ltr"
            aria-label={labels.amount}
            defaultValue={monthlyAmount}
            className="border-line bg-raised text-text w-20 rounded-[8px] border px-2 py-1 text-center text-xs"
          />
          <button type="submit" disabled={pending} aria-label={labels.save} className={`${icon} hover:text-pos`}>
            <Check size={14} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
            aria-label={labels.cancel}
            className={`${icon} hover:text-text`}
          >
            <X size={14} aria-hidden />
          </button>
        </div>
        {error ? <p className="text-neg text-[10px]">{error}</p> : null}
      </form>
    );
  }

  return (
    <div className="flex items-center gap-0.5">
      <span className="text-dim text-[10px]">{labels.spent}</span>
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={labels.edit}
        data-tip={labels.edit}
        className={`${icon} hover:text-text`}
      >
        <Pencil size={13} aria-hidden />
      </button>
      <button
        type="button"
        disabled={pending}
        aria-label={labels.remove}
        data-tip={labels.remove}
        onClick={() => startTransition(() => deleteBudgetAction(id))}
        className={`${icon} hover:text-neg`}
      >
        <Trash2 size={13} aria-hidden />
      </button>
    </div>
  );
}
