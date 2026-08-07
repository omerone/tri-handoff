'use client';

import { useActionState, useState } from 'react';
import { Plus } from 'lucide-react';
import { DateField } from '@/components/ui/date-field';
import { FormMessage, SubmitButton } from '@/components/ui/form';
import { createFinanceEntryAction, type FinanceFormState } from './actions';

export type EntryFormLabels = {
  label: string;
  amount: string;
  category: string;
  date: string;
  typeIncome: string;
  typeExpense: string;
  recurring: string;
  recurringHint: string;
  add: string;
};

export type CategoryOption = { value: string; label: string };

/**
 * The add-entry row from the prototype, with the two things the prototype left out: a
 * category and a recurring flag (both 🔶 in SPEC §3.1, both resolved as "yes").
 *
 * The category input is free text backed by a datalist rather than a select. One user per
 * tenant means whatever words that person thinks in are the correct ones — but with no
 * suggestions at all, "Food", "food" and "Groceries" become three categories by the third
 * month and the breakdown stops meaning anything.
 */
export function EntryForm({
  labels,
  categories,
  defaultDate,
  window,
}: {
  labels: EntryFormLabels;
  categories: { income: CategoryOption[]; expense: CategoryOption[] };
  /** Today, formatted on the server so the field does not depend on the client's clock. */
  defaultDate: string;
  /**
   * What the screen is currently showing, as `yyyy-mm-dd` bounds. Posted with the entry so
   * the action can tell whether the thing just added would land somewhere the user cannot
   * see, and move the window to it if so.
   */
  window: { from: string; to: string };
}) {
  const [state, action] = useActionState<FinanceFormState, FormData>(
    createFinanceEntryAction,
    {},
  );
  const [type, setType] = useState<'income' | 'expense'>('expense');
  const options = type === 'income' ? categories.income : categories.expense;

  const field =
    'border-line bg-raised text-text placeholder:text-dim/60 min-h-11 w-full rounded-[10px] border px-3 py-2 text-sm sm:min-h-9 sm:w-auto';

  return (
    <form action={action} className="flex flex-col gap-3">
      <FormMessage error={state.error} />
      <input type="hidden" name="windowFrom" value={window.from} />
      <input type="hidden" name="windowTo" value={window.to} />

      {/* Two columns on a phone, the original inline row from `sm` — see the note on the
          same grid in `long/manual-trade-form.tsx`. */}
      <div className="grid grid-cols-2 items-end gap-x-2 gap-y-3 sm:flex sm:flex-wrap sm:gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-dim text-[11px] font-semibold">{labels.typeExpense}</span>
          <select
            name="type"
            value={type}
            onChange={(event) => setType(event.target.value as 'income' | 'expense')}
            className={field}
          >
            <option value="expense">{labels.typeExpense}</option>
            <option value="income">{labels.typeIncome}</option>
          </select>
        </label>

        <label className="flex min-w-[9rem] flex-1 flex-col gap-1">
          <span className="text-dim text-[11px] font-semibold">{labels.label}</span>
          <input name="label" required maxLength={120} className={field} />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-dim text-[11px] font-semibold">{labels.category}</span>
          <input
            name="category"
            list="tri-finance-categories"
            className={`${field} sm:w-36`}
            autoComplete="off"
          />
          <datalist id="tri-finance-categories">
            {options.map((option) => (
              <option key={option.value} value={option.label} />
            ))}
          </datalist>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-dim text-[11px] font-semibold">{labels.amount} (₪)</span>
          <input
            name="amountIls"
            type="number"
            step="0.01"
            min="0.01"
            required
            dir="ltr"
            className={`${field} sm:w-28`}
          />
        </label>

        <DateField
          name="entryDate"
          defaultValue={defaultDate}
          label={labels.date}
          required
          className={`${field} sm:w-40`}
          wrapperClassName="col-span-2 sm:col-auto"
        />

        <SubmitButton className="col-span-2 w-full sm:col-auto sm:w-auto">
          <span className="inline-flex items-center gap-1.5">
            <Plus size={14} aria-hidden /> {labels.add}
          </span>
        </SubmitButton>
      </div>

      {/* The box itself was 13px square. Sized up to the 20px the platform draws a checkbox
          at, with the whole label as the hit area — which is what a <label> already gives,
          once it is tall enough to aim at. */}
      <label className="text-dim flex min-h-11 items-start gap-2 py-1 text-xs sm:min-h-0 sm:items-center">
        <input
          type="checkbox"
          name="isRecurring"
          className="accent-brand mt-0.5 h-5 w-5 shrink-0 sm:mt-0 sm:h-4 sm:w-4"
        />
        <span>
          {labels.recurring}
          <span className="text-dim/70"> · {labels.recurringHint}</span>
        </span>
      </label>
    </form>
  );
}
