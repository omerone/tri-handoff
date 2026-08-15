'use client';

import { useActionState, useEffect, useOptimistic, useRef, useState, useTransition } from 'react';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import {
  createGoalAction,
  deleteGoalAction,
  editGoalAction,
  setGoalDoneAction,
  type GoalFormState,
} from './actions';

export type DayOption = { value: string; label: string };

export type GoalFormLabels = {
  title: string;
  titlePlaceholder: string;
  day: string;
  add: string;
};

const FIELD =
  'border-line bg-raised text-text placeholder:text-dim/60 min-h-11 w-full rounded-[10px] border px-3 py-2 text-sm sm:min-h-9';

/**
 * Writing one down.
 *
 * Title and a day, and nothing else. A checklist earns its keep by being faster to add to than
 * to think about — every field beyond these two is a decision taken at the moment somebody is
 * trying to get something out of their head and onto a list.
 */
export function GoalForm({
  owner,
  days,
  defaultDay,
  labels,
}: {
  owner: string;
  days: DayOption[];
  defaultDay: string;
  labels: GoalFormLabels;
}) {
  const [state, action] = useActionState<GoalFormState, FormData>(createGoalAction, {});
  const form = useRef<HTMLFormElement>(null);
  const title = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!state.ok) return;
    /*
     * Reset, then put the cursor back. Goals arrive in runs — a person sits down once a week
     * and writes six — and a form that clears itself and then makes you click it again to
     * write the next one is a form you stop using after the second.
     *
     * The day is deliberately not reset with it: a run of goals is usually a run for the same
     * day, so `form.reset()` would send you back to the picker between every one.
     */
    const day = form.current?.querySelector<HTMLSelectElement>('select[name="dueOn"]')?.value;
    form.current?.reset();
    if (day) {
      const picker = form.current?.querySelector<HTMLSelectElement>('select[name="dueOn"]');
      if (picker) picker.value = day;
    }
    title.current?.focus();
  }, [state]);

  return (
    <form ref={form} action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="owner" value={owner} />

      <label className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-dim text-[11px] font-semibold">{labels.title}</span>
        <input
          ref={title}
          name="title"
          required
          maxLength={160}
          placeholder={labels.titlePlaceholder}
          className={FIELD}
        />
      </label>

      <label className="flex w-36 flex-col gap-1">
        <span className="text-dim text-[11px] font-semibold">{labels.day}</span>
        <select name="dueOn" defaultValue={defaultDay} className={FIELD}>
          {days.map((day) => (
            <option key={day.value} value={day.value}>
              {day.label}
            </option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        className="bg-brand text-on-brand inline-flex min-h-11 items-center gap-1.5 rounded-[10px] px-4 text-sm font-bold sm:min-h-9"
      >
        <Plus size={14} aria-hidden /> {labels.add}
      </button>

      {state.error ? <p className="text-neg w-full text-xs">{state.error}</p> : null}
    </form>
  );
}

export type GoalRowLabels = {
  done: string;
  edit: string;
  remove: string;
  save: string;
  cancel: string;
  title: string;
  day: string;
};

/**
 * One goal on the list: the box, what it says, and the two things you can do to it.
 *
 * The whole row is the tick target rather than the 16px box on the end of it. This is read on
 * a phone with one hand, and a checklist whose checkboxes are hard to hit is a checklist that
 * gets ticked wrong — which is worse than not ticked, because the statistic beside it is built
 * on those ticks.
 */
export function GoalRow({
  id,
  title,
  done,
  days,
  dueOn,
  overdue,
  labels,
}: {
  id: string;
  title: string;
  done: boolean;
  days: DayOption[];
  dueOn: string;
  /** Unticked, on a day that has gone. Said in the row, because the statistic counts it. */
  overdue: boolean;
  labels: GoalRowLabels;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  /*
   * The box moves on the tap, not on the round trip.
   *
   * It was drawn straight from the server's answer, so a tick sat visibly unticked until the
   * request came back — on a phone on mobile data that is long enough to tap it again, which
   * posts the opposite and lands you back where you started. React drops this the moment the
   * real value arrives, so a write that fails still snaps back rather than lying.
   */
  const [ticked, setTicked] = useOptimistic(done);

  const icon =
    'tri-tap text-dim flex size-8 shrink-0 items-center justify-center rounded-lg disabled:opacity-40';

  if (editing) {
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          startTransition(async () => {
            const message = await editGoalAction(
              id,
              String(data.get('title') ?? ''),
              String(data.get('dueOn') ?? ''),
            );
            setError(message);
            // Left open on a refusal, so what was typed is still there to correct.
            if (!message) setEditing(false);
          });
        }}
        className="border-line flex flex-col gap-1.5 border-b py-2 last:border-b-0"
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            name="title"
            required
            autoFocus
            maxLength={160}
            defaultValue={title}
            aria-label={labels.title}
            className={`${FIELD} min-w-0 flex-1`}
          />
          <select name="dueOn" defaultValue={dueOn} aria-label={labels.day} className={`${FIELD} w-32`}>
            {days.map((day) => (
              <option key={day.value} value={day.value}>
                {day.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={pending}
            aria-label={labels.save}
            className={`${icon} text-pos hover:bg-raised`}
          >
            <Check size={15} aria-hidden />
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
            <X size={15} aria-hidden />
          </button>
        </div>
        {error ? <p className="text-neg text-[11px]">{error}</p> : null}
      </form>
    );
  }

  return (
    <div className="border-line flex items-center gap-2 border-b py-1.5 last:border-b-0">
      <label className="tri-tap flex min-h-9 min-w-0 flex-1 cursor-pointer items-center gap-2.5">
        <input
          type="checkbox"
          checked={ticked}
          aria-label={`${labels.done}: ${title}`}
          /* The next state is posted, not toggled from what the server finds — see the
             action. A toggle computed there turns a double-tap into a tick and an untick. */
          onChange={(event) => {
            const next = event.currentTarget.checked;
            startTransition(async () => {
              setTicked(next);
              await setGoalDoneAction(id, next);
            });
          }}
          className="accent-brand h-5 w-5 shrink-0"
        />
        <span
          className={`min-w-0 truncate text-[13px] ${
            ticked ? 'text-dim line-through' : overdue ? 'text-neg font-medium' : 'text-text'
          }`}
        >
          {title}
        </span>
      </label>

      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`${labels.edit}: ${title}`}
        data-tip={labels.edit}
        className={`${icon} hover:text-text`}
      >
        <Pencil size={13} aria-hidden />
      </button>
      <button
        type="button"
        disabled={pending}
        aria-label={`${labels.remove}: ${title}`}
        data-tip={labels.remove}
        onClick={() => startTransition(() => deleteGoalAction(id))}
        className={`${icon} hover:text-neg`}
      >
        <Trash2 size={13} aria-hidden />
      </button>
    </div>
  );
}
