'use client';

import { useActionState } from 'react';
import { Plus } from 'lucide-react';
import { DateField } from '@/components/ui/date-field';
import { FormMessage, SubmitButton } from '@/components/ui/form';
import { createLearningEntryAction, type LearningFormState } from './actions';

export type LearningFormLabels = {
  /** "Who studied" — the field label. */
  learner: string;
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
  learner,
}: {
  labels: LearningFormLabels;
  /** Formatted on the server, so the field does not depend on the client's clock. */
  defaultDate: string;
  /**
   * The header switch's position — who this session belongs to, stated rather than asked.
   *
   * The field has been free text, then a datalist, then a select of the two brothers; every
   * form of asking allowed the same contradiction, a session entered on אביתר's screen and
   * attributed to יוני, gone from view the moment it saved. The switch already answered.
   */
  learner: string;
}) {
  const [state, action] = useActionState<LearningFormState, FormData>(
    createLearningEntryAction,
    {},
  );

  const field =
    'border-line bg-raised text-text placeholder:text-dim/60 min-h-11 w-full rounded-[10px] border px-3 py-2 text-sm sm:min-h-9 sm:w-auto';

  return (
    <form action={action} className="flex flex-col gap-3">
      <FormMessage error={state.error} />

      {/* Two columns on a phone, the original inline row from `sm` — see the note on the
          same grid in `long/manual-trade-form.tsx`. */}
      <div className="grid grid-cols-2 items-end gap-x-2 gap-y-3 sm:flex sm:flex-wrap sm:gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-dim text-[11px] font-semibold">{labels.topic}</span>
          <select name="topic" defaultValue="technical" className={`${field} sm:w-36`}>
            <option value="technical">{labels.topics.technical}</option>
            <option value="psychology">{labels.topics.psychology}</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-dim text-[11px] font-semibold">{labels.hours}</span>
          <input
            name="hours"
            required
            inputMode="decimal"
            dir="ltr"
            placeholder="1.5"
            className={`${field} sm:w-24`}
          />
        </label>

        {/*
          Ordered in the source rather than with `order` utilities, which is the lesson of the
          first attempt: the submit button carries no order of its own, so giving three fields
          one sorted the button ahead of them and it landed in the middle of the form.

          Hours sits beside the topic because both are short. This field then takes the whole
          row, which on a phone it needs — a half cell gave it 169px and the placeholder is
          three examples long, clipped before the first one ended.
        */}
        <label className="flex flex-col gap-1 sm:min-w-[9rem]">
          <span className="text-dim text-[11px] font-semibold">{labels.learner}</span>
          {/* Stated, not asked — the header switch is where "whose" changes. */}
          <span className={`${field} flex items-center font-semibold`}>{learner}</span>
          <input type="hidden" name="learner" value={learner} />
        </label>

        <label className="col-span-2 flex flex-col gap-1 sm:col-auto sm:min-w-[12rem] sm:flex-1">
          <span className="text-dim text-[11px] font-semibold">{labels.what}</span>
          <input
            name="title"
            required
            maxLength={120}
            placeholder={labels.whatPlaceholder}
            className={field}
          />
        </label>

        <DateField
          name="learnedOn"
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
