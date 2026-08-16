'use client';

import { SuggestField } from '@/components/ui/suggest-field';

import { useActionState } from 'react';
import { Check, Plus } from 'lucide-react';
import { DateField } from '@/components/ui/date-field';
import { FormMessage, SubmitButton } from '@/components/ui/form';
import {
  createLearningEntryAction,
  updateLearningEntryAction,
  type LearningFormState,
} from './actions';

export type LearningFormLabels = {
  /** "Who studied" — the field label. */
  learner: string | null;
  what: string;
  whatPlaceholder: string;
  hours: string;
  minutes: string;
  topic: string;
  date: string;
  note: string;
  notePlaceholder: string;
  add: string;
  /** The submit button when the form is rewriting a row rather than adding one. */
  save: string;
  cancel: string;
  topics: { psychology: string; technical: string };
  /** Built-ins first, then whatever this trader has written before. */
  topicOptions: string[];
};

/**
 * The add-session row, shaped like the finance one so the two ledgers are operated the same
 * way: pick a kind, describe it, give it a number and a date.
 */
/**
 * A session already recorded, when this form is rewriting one rather than adding one.
 *
 * The hours arrive split back into hours and minutes, because that is the shape the two
 * fields hold — reversing the arithmetic in the component would put the rounding in a second
 * place, and the two would drift.
 */
export type LearningEntryEdit = {
  id: string;
  topic: string;
  title: string;
  note: string;
  hours: string;
  minutes: string;
  learnedOn: string;
};

export function LearningEntryForm({
  labels,
  defaultDate,
  learner,
  editing,
}: {
  labels: LearningFormLabels;
  /** Formatted on the server, so the field does not depend on the client's clock. */
  defaultDate: string;
  /**
   * The header switch's position — who this session belongs to, stated rather than asked.
   *
   * The field has been free text, then a suggestion list, then a select of the two brothers; every
   * form of asking allowed the same contradiction, a session entered on אביתר's screen and
   * attributed to יוני, gone from view the moment it saved. The switch already answered.
   */
  learner: string | null;
  /**
   * The row being rewritten, or undefined when this is the add form.
   *
   * One component for both, rather than a second form beside it. The fields, the validation
   * and the arithmetic are the same either way — the only honest difference is where the
   * result goes — and two copies of a form is how a screen ends up accepting on Tuesday what
   * it refused on Monday.
   */
  editing?: LearningEntryEdit;
}) {
  const [state, action] = useActionState<LearningFormState, FormData>(
    editing ? updateLearningEntryAction : createLearningEntryAction,
    {},
  );

  const field =
    'border-line bg-raised text-text placeholder:text-dim/60 min-h-11 w-full rounded-[10px] border px-3 py-2 text-sm sm:min-h-9 sm:w-auto';

  return (
    /*
     * `key` on the row's id: React keeps an uncontrolled input's value across a re-render, so
     * moving from one row's edit form to another's — or back to the add form — would leave the
     * previous session's words in the fields. A new key is a new form.
     */
    <form action={action} key={editing?.id ?? 'new'} className="flex flex-col gap-3">
      <FormMessage error={state.error} />
      {editing ? <input type="hidden" name="id" value={editing.id} /> : null}

      {/* Two columns on a phone, the original inline row from `sm` — see the note on the
          same grid in `long/manual-trade-form.tsx`. */}
      {/*
        One row from `lg`, and it has to stay one.
        
        Seven controls on `flex-wrap` fit until they do not, and what gave way was the date and
        the button — they dropped to a second line with the whole width of the card empty
        beside them, which reads as two forms rather than one. Nothing here needs a generous
        width: the widest is a free-text topic, and the numbers are two digits. So the row
        stops wrapping and the fields give way instead, each shrinking to what it holds.
        
        Below `lg` it is still two columns — that is a phone, where one row of seven would be
        unreadable at any width. The note keeps its own line at every size, because it is a
        sentence rather than a field.
      */}
      <div className="grid grid-cols-2 items-end gap-x-2 gap-y-3 sm:flex sm:flex-wrap sm:gap-2 lg:flex-nowrap">
        {/*
          A field, not a dropdown.
          
          The two the product ships with are not the whole of the craft — an evening spent
          back-testing is neither — and a closed list means every new answer is a migration.
          This is the same shape the trade journal already uses for strategy and tags: type
          anything, and what has been typed before is offered so it is chosen rather than
          re-typed. `list` gives that natively, so there is no dropdown to open on a phone and
          nothing to hydrate.
          
          The grouping folds case and spacing, so "Back test" and "backtest" are one topic
          whichever way it is typed on the day — see `topicKey`.
        */}
        <label className="flex flex-col gap-1">
          <span className="text-dim text-[11px] font-semibold">{labels.topic}</span>
          <SuggestField
            name="topic"
            options={labels.topicOptions}
            required
            defaultValue={editing?.topic ?? labels.topics.technical}
            boxClassName="sm:w-40 lg:w-auto lg:min-w-0 lg:flex-1"
            className={`${field} sm:w-full`}
          />
        </label>

        {/*
          Two fields, not one decimal.
          
          A session is remembered as "an hour and a half" or "thirty-five minutes", and only
          one of those is a number anybody wants to convert. `1.5` is easy; 35 minutes is
          0.58333… and the trader was either rounding it or doing arithmetic to fill in a form.
          Both are still optional on their own — 45 minutes is minutes with the hours left
          empty — and the action refuses only when the pair adds up to nothing.
        */}
        <label className="flex flex-col gap-1">
          <span className="text-dim text-[11px] font-semibold">{labels.hours}</span>
          <input
            name="hours"
            inputMode="numeric"
            dir="ltr"
            placeholder="1"
            defaultValue={editing?.hours ?? ''}
            className={`${field} sm:w-20 lg:w-16 lg:shrink`}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-dim text-[11px] font-semibold">{labels.minutes}</span>
          <input
            name="minutes"
            inputMode="numeric"
            dir="ltr"
            placeholder="30"
            defaultValue={editing?.minutes ?? ''}
            className={`${field} sm:w-20 lg:w-16 lg:shrink`}
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
        {/* Stated, not asked — the header switch is where "whose" changes. A household of
            one states nothing, caption included: every session is theirs. */}
        {learner !== null ? (
          <label className="flex flex-col gap-1 sm:min-w-[9rem] lg:min-w-0 lg:shrink">
            <span className="text-dim text-[11px] font-semibold">{labels.learner}</span>
            <span className={`${field} flex items-center font-semibold`}>{learner}</span>
            <input type="hidden" name="learner" value={learner} />
          </label>
        ) : null}

        <label className="col-span-2 flex flex-col gap-1 sm:col-auto sm:min-w-[12rem] sm:flex-1 lg:min-w-0">
          <span className="text-dim text-[11px] font-semibold">{labels.what}</span>
          <input
            name="title"
            required
            maxLength={120}
            placeholder={labels.whatPlaceholder}
            defaultValue={editing?.title ?? ''}
            className={field}
          />
        </label>

        <DateField
          name="learnedOn"
          defaultValue={editing?.learnedOn ?? defaultDate}
          label={labels.date}
          required
          className={`${field} sm:w-40 lg:w-36 lg:shrink-0`}
          wrapperClassName="col-span-2 sm:col-auto"
        />

        <SubmitButton className="col-span-2 w-full sm:col-auto sm:w-auto lg:shrink-0 lg:whitespace-nowrap">
          <span className="inline-flex items-center gap-1.5">
            {editing ? <Check size={14} aria-hidden /> : <Plus size={14} aria-hidden />}
            {editing ? labels.save : labels.add}
          </span>
        </SubmitButton>

        {/* A way out that is not the browser's back button: the form is a URL, so leaving it
            is a link back to the plain list rather than anything this component has to undo.
            A plain anchor for the same reason the edit link is one — see the note there. */}
        {editing ? (
          <a
            href="/learning"
            className="text-dim hover:text-text col-span-2 flex min-h-11 items-center justify-center rounded-[10px] px-3 text-sm sm:col-auto sm:min-h-9 lg:shrink-0"
          >
            {labels.cancel}
          </a>
        ) : null}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-dim text-[11px] font-semibold">{labels.note}</span>
        <textarea
          name="note"
          rows={2}
          maxLength={2000}
          placeholder={labels.notePlaceholder}
          defaultValue={editing?.note ?? ''}
          className={field}
        />
      </label>
    </form>
  );
}
