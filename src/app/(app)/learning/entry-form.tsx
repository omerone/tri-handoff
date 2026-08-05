'use client';

import { useActionState } from 'react';
import { Plus } from 'lucide-react';
import { DateField } from '@/components/ui/date-field';
import { FormMessage, SubmitButton } from '@/components/ui/form';
import { createLearningEntryAction, type LearningFormState } from './actions';

export type LearningFormLabels = {
  what: string;
  whatPlaceholder: string;
  hours: string;
  topic: string;
  date: string;
  note: string;
  notePlaceholder: string;
  add: string;
  topics: { psychology: string; technical: string };
};

/**
 * The add-session row, shaped like the finance one so the two ledgers are operated the same
 * way: pick a kind, describe it, give it a number and a date.
 */
export function LearningEntryForm({
  labels,
  defaultDate,
}: {
  labels: LearningFormLabels;
  /** Formatted on the server, so the field does not depend on the client's clock. */
  defaultDate: string;
}) {
  const [state, action] = useActionState<LearningFormState, FormData>(
    createLearningEntryAction,
    {},
  );

  const field =
    'border-line bg-raised text-text placeholder:text-dim/60 rounded-[10px] border px-3 py-2 text-sm';

  return (
    <form action={action} className="flex flex-col gap-3">
      <FormMessage error={state.error} />

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-dim text-[11px] font-semibold">{labels.topic}</span>
          <select name="topic" defaultValue="technical" className={`${field} w-36`}>
            <option value="technical">{labels.topics.technical}</option>
            <option value="psychology">{labels.topics.psychology}</option>
          </select>
        </label>

        <label className="flex min-w-[12rem] flex-1 flex-col gap-1">
          <span className="text-dim text-[11px] font-semibold">{labels.what}</span>
          <input
            name="title"
            required
            maxLength={120}
            placeholder={labels.whatPlaceholder}
            className={field}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-dim text-[11px] font-semibold">{labels.hours}</span>
          <input
            name="hours"
            required
            inputMode="decimal"
            dir="ltr"
            placeholder="1.5"
            className={`${field} w-24`}
          />
        </label>

        <DateField
          name="learnedOn"
          defaultValue={defaultDate}
          label={labels.date}
          required
          className={`${field} w-40`}
        />

        <SubmitButton>
          <span className="inline-flex items-center gap-1.5">
            <Plus size={14} aria-hidden /> {labels.add}
          </span>
        </SubmitButton>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-dim text-[11px] font-semibold">{labels.note}</span>
        <textarea
          name="note"
          rows={2}
          maxLength={2000}
          placeholder={labels.notePlaceholder}
          className={field}
        />
      </label>
    </form>
  );
}
