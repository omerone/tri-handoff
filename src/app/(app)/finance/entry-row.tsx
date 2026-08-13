'use client';

import { useActionState, useState } from 'react';
import { Check, Pencil, Repeat, Trash2, X } from 'lucide-react';
import { Num } from '@/components/ui/kpi';
import { DateField } from '@/components/ui/date-field';
import { SuggestField } from '@/components/ui/suggest-field';
import {
  deleteFinanceEntryAction,
  editFinanceEntryAction,
  endRecurringSeriesAction,
  type FinanceFormState,
} from './actions';

export type EntryRowLabels = {
  recurringBadge: string;
  delete: string;
  deleteConfirm: string;
  endSeries: string;
  endSeriesConfirm: string;
  deleteSeriesConfirm: string;
  edit: string;
  save: string;
  cancel: string;
  label: string;
  category: string;
  amount: string;
  date: string;
  typeIncome: string;
  typeExpense: string;
  /** Said over the editor of a recurring row, which is one rule and not one month. */
  editsEveryMonth: string;
};

export type EntryRowData = {
  id: string;
  type: 'income' | 'expense';
  label: string;
  category: string;
  /**
   * Whose money, shown only in the household view — narrowed to one brother every row is his
   * and a chip on each would be a column of the same word. Null (a shared row) shows nothing:
   * unattributed is the default state, not a fact worth a badge.
   */
  owner: string | null;
  /** Preformatted on the server, so the row does not need the locale or the rate. */
  amount: string;
  date: string;
  isRecurring: boolean;
  /** True when this instance was generated from a recurring rule rather than stored. */
  generated: boolean;
  /**
   * The row's own values, unformatted, for the editor.
   *
   * Separate from the fields above because those are prepared for reading — the amount
   * carries a currency symbol, the category is translated, the date is a day and a month.
   * Putting either set to the other's use is how an edit saves "₪1,800" as a label.
   */
  edit: {
    category: string;
    amountIls: number;
    /** The *stored* date, not the occurrence's — they differ on a generated month. */
    date: string;
  };
};

export function EntryRow({
  entry,
  month,
  labels,
  categories,
}: {
  entry: EntryRowData;
  month: { year: number; month: number };
  labels: EntryRowLabels;
  /** What the category field offers, the same list the form above the list offers. */
  categories: { income: string[]; expense: string[] };
}) {
  const income = entry.type === 'income';
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <EntryEditor
        entry={entry}
        labels={labels}
        categories={categories}
        onDone={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="border-line flex items-center justify-between gap-3 border-b py-2.5 last:border-b-0">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${income ? 'bg-pos' : 'bg-neg'}`}
          aria-hidden
        />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold">{entry.label}</div>
          <div className="text-dim flex items-center gap-2 text-[11px]">
            <Num>{entry.date}</Num>
            <span>·</span>
            <span className="truncate">{entry.category}</span>
            {entry.owner ? (
              <span className="border-line bg-raised text-text rounded-full border px-1.5 py-px text-[10px] font-semibold">
                {entry.owner}
              </span>
            ) : null}
            {entry.isRecurring ? (
              <span className="text-brand inline-flex items-center gap-1">
                <Repeat size={10} aria-hidden />
                {labels.recurringBadge}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <div className={`font-bold ${income ? 'text-pos' : 'text-neg'}`}>
          <Num>
            {income ? '+' : '−'}
            {entry.amount}
          </Num>
        </div>

        <button
          type="button"
          onClick={() => setEditing(true)}
          data-tip={labels.edit}
          aria-label={`${labels.edit}: ${entry.label}`}
          className="text-dim hover:text-text"
        >
          <Pencil size={14} aria-hidden />
        </button>

        {/*
          A recurring series offers both actions, and they mean different things.

          *End series* is the normal one: it stops the entry from here on and leaves every
          month it has already appeared in untouched, so last year's balance does not change
          because someone left a job. *Delete* removes it from every month — which is wrong
          for a salary that ended, and exactly right for one that was entered by mistake.
          Without it a mistyped recurring entry would be uncorrectable forever.
        */}
        {entry.isRecurring ? (
          <form action={endRecurringSeriesAction}>
            <input type="hidden" name="id" value={entry.id} />
            <input type="hidden" name="year" value={month.year} />
            <input type="hidden" name="month" value={month.month} />
            <button
              type="submit"
              data-tip={labels.endSeries}
              aria-label={labels.endSeries}
              onClick={(event) => {
                if (!window.confirm(labels.endSeriesConfirm)) event.preventDefault();
              }}
              className="text-dim hover:text-warn"
            >
              <Repeat size={14} aria-hidden />
            </button>
          </form>
        ) : null}

        <form action={deleteFinanceEntryAction}>
          <input type="hidden" name="id" value={entry.id} />
          <button
            type="submit"
            data-tip={labels.delete}
            aria-label={labels.delete}
            onClick={(event) => {
              const message = entry.isRecurring ? labels.deleteSeriesConfirm : labels.deleteConfirm;
              if (!window.confirm(message)) event.preventDefault();
            }}
            className="text-dim hover:text-neg"
          >
            <Trash2 size={14} aria-hidden />
          </button>
        </form>
      </div>
    </div>
  );
}

/**
 * The same row, open for correction.
 *
 * In place rather than in the form at the top of the card: that form writes a *new* entry, and
 * using it to fix one means deleting the old row first — which is what people were doing, and
 * it loses the row's history along with the mistake.
 *
 * **A recurring row is offered no date.** Its date is the anchor its months are counted from,
 * and this can be opened from any occurrence: writing back the March instance of a January
 * rule would shift every other month by two. The action refuses to touch the column when the
 * field is absent, so the omission here is the whole mechanism rather than a hint to the user.
 * What the change *does* affect is said out loud instead — one rule, every month.
 */
function EntryEditor({
  entry,
  labels,
  categories,
  onDone,
}: {
  entry: EntryRowData;
  labels: EntryRowLabels;
  categories: { income: string[]; expense: string[] };
  onDone: () => void;
}) {
  const [type, setType] = useState<'income' | 'expense'>(entry.type);
  const [state, action, pending] = useActionState<FinanceFormState, FormData>(
    async (previous, formData) => {
      const result = await editFinanceEntryAction(previous, formData);
      // Left open on a refusal, so what was typed is still there to correct.
      if (result.ok) onDone();
      return result;
    },
    {},
  );

  const field =
    'border-line bg-raised text-text placeholder:text-dim/60 min-h-11 w-full rounded-[10px] border px-2.5 py-2 text-sm sm:min-h-9';
  const icon = 'tri-tap flex size-9 shrink-0 items-center justify-center rounded-lg disabled:opacity-40';

  return (
    <form action={action} className="border-line flex flex-col gap-2 border-b py-2.5 last:border-b-0">
      <input type="hidden" name="id" value={entry.id} />

      <div className="grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap">
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

        <label className="col-span-2 flex min-w-[9rem] flex-1 flex-col gap-1">
          <span className="text-dim text-[11px] font-semibold">{labels.label}</span>
          <input name="label" required maxLength={120} defaultValue={entry.label} className={field} />
        </label>

        <div className="flex flex-col gap-1 sm:w-36">
          <span className="text-dim text-[11px] font-semibold">{labels.category}</span>
          <SuggestField
            name="category"
            options={type === 'income' ? categories.income : categories.expense}
            defaultValue={entry.edit.category}
            className={field}
          />
        </div>

        <label className="flex flex-col gap-1 sm:w-28">
          <span className="text-dim text-[11px] font-semibold">{labels.amount}</span>
          <input
            name="amountIls"
            type="number"
            step="0.01"
            min="0.01"
            required
            dir="ltr"
            defaultValue={entry.edit.amountIls}
            className={field}
          />
        </label>

        {entry.isRecurring ? null : (
          <DateField
            name="entryDate"
            defaultValue={entry.edit.date}
            label={labels.date}
            required
            className={`${field} sm:w-40`}
            wrapperClassName="col-span-2 sm:col-auto"
          />
        )}

        <div className="col-span-2 flex items-center gap-1 sm:col-auto sm:self-end sm:pb-0.5">
          <button
            type="submit"
            disabled={pending}
            aria-label={labels.save}
            data-tip={labels.save}
            className={`${icon} text-pos hover:bg-raised`}
          >
            <Check size={16} aria-hidden />
          </button>
          <button
            type="button"
            onClick={onDone}
            aria-label={labels.cancel}
            data-tip={labels.cancel}
            className={`${icon} text-dim hover:text-text`}
          >
            <X size={16} aria-hidden />
          </button>
        </div>
      </div>

      {entry.isRecurring ? (
        <p className="text-dim flex items-center gap-1.5 text-[11px]">
          <Repeat size={11} aria-hidden />
          {labels.editsEveryMonth}
        </p>
      ) : null}
      {state.error ? <p className="text-neg text-xs">{state.error}</p> : null}
    </form>
  );
}
