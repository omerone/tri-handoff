'use client';

import { Repeat, Trash2 } from 'lucide-react';
import { Num } from '@/components/ui/kpi';
import { deleteFinanceEntryAction, endRecurringSeriesAction } from './actions';

export type EntryRowLabels = {
  recurringBadge: string;
  delete: string;
  deleteConfirm: string;
  endSeries: string;
  endSeriesConfirm: string;
  deleteSeriesConfirm: string;
};

export type EntryRowData = {
  id: string;
  type: 'income' | 'expense';
  label: string;
  category: string;
  /** Preformatted on the server, so the row does not need the locale or the rate. */
  amount: string;
  date: string;
  isRecurring: boolean;
  /** True when this instance was generated from a recurring rule rather than stored. */
  generated: boolean;
};

export function EntryRow({
  entry,
  month,
  labels,
}: {
  entry: EntryRowData;
  month: { year: number; month: number };
  labels: EntryRowLabels;
}) {
  const income = entry.type === 'income';

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
