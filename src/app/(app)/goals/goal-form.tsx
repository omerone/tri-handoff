'use client';

import { useActionState, useEffect, useOptimistic, useRef, useState, useTransition } from 'react';
import { Check, Pencil, Plus, StickyNote, Trash2, X } from 'lucide-react';
import {
  createGoalAction,
  deleteGoalAction,
  editGoalAction,
  setDayNoteAction,
  setGoalDoneAction,
  type GoalFormState,
} from './actions';

export type DayOption = { value: string; label: string };

const FIELD =
  'border-line bg-raised text-text placeholder:text-dim/60 min-h-11 w-full rounded-[10px] border px-3 py-2 text-sm sm:min-h-9';

export type DayAddLabels = {
  add: string;
  placeholder: string;
  save: string;
  cancel: string;
  /** Names the day, for a reader who cannot see which card the field is in. */
  field: string;
};

/**
 * Writing one down, on the day you are looking at.
 *
 * This was a single form above the week with the day in a dropdown, and the client found the
 * hole in it straight away: the days are drawn as cards, they look like something you can
 * press, and pressing one did nothing. Adding to Wednesday meant scrolling back up and
 * finding Wednesday again in a list of seven — having just pointed at it.
 *
 * So the day is not asked for any more, it is *where you are*. The card carries the field and
 * the value is fixed by the card it is in, which also means it cannot be got wrong.
 *
 * It stays open after each one. Goals arrive in runs — somebody sits down once a week and
 * writes four for the same day — and a field that closes itself after every save turns four
 * goals into eight clicks.
 */
export function DayAdd({
  owner,
  day,
  labels,
}: {
  owner: string | null;
  /** `yyyy-mm-dd`, fixed by the card. Not a field, so there is nothing to pick wrongly. */
  day: string;
  labels: DayAddLabels;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<GoalFormState, FormData>(createGoalAction, {});
  const form = useRef<HTMLFormElement>(null);
  const title = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!state.ok) return;
    form.current?.reset();
    title.current?.focus();
  }, [state]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="tri-tap text-dim hover:text-brand flex min-h-9 w-full items-center gap-1.5 rounded-lg text-[12px] font-semibold"
      >
        <Plus size={13} aria-hidden />
        {labels.add}
      </button>
    );
  }

  return (
    <form
      ref={form}
      action={action}
      onKeyDown={(event) => {
        // Stopped here, or the sheet a form sits in on a phone would close along with it.
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        setOpen(false);
      }}
      className="flex flex-col gap-1 pt-1"
    >
      {owner !== null ? <input type="hidden" name="owner" value={owner} /> : null}
      <input type="hidden" name="dueOn" value={day} />

      <div className="flex items-center gap-1">
        <input
          ref={title}
          name="title"
          required
          autoFocus
          maxLength={160}
          aria-label={labels.field}
          placeholder={labels.placeholder}
          className={`${FIELD} min-w-0 flex-1`}
        />
        <button
          type="submit"
          aria-label={labels.save}
          className="tri-tap text-pos hover:bg-raised flex size-8 shrink-0 items-center justify-center rounded-lg"
        >
          <Check size={15} aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={labels.cancel}
          className="tri-tap text-dim hover:text-text flex size-8 shrink-0 items-center justify-center rounded-lg"
        >
          <X size={15} aria-hidden />
        </button>
      </div>

      {state.error ? <p className="text-neg text-[11px]">{state.error}</p> : null}
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

export type DayNoteLabels = {
  /** The button when the day has nothing written on it yet. */
  add: string;
  /** Names the field, and the button once there is something to reopen. */
  edit: string;
  placeholder: string;
  save: string;
  cancel: string;
  /** Said under the field: clearing it is how a note is removed. */
  clearHint: string;
};

/**
 * A line about the day, under its goals.
 *
 * Not a goal, and deliberately not shaped like one. The week's figures are counted out of the
 * checklist above it, so a note wearing a tick box would be counted — and every day somebody
 * wrote a sentence on would read as a day with something left undone. Writing things down has
 * to be free, or the measure beside it quietly discourages it.
 *
 * Shown rather than hidden behind a control once it exists. A note is the context for the list
 * it sits under — "market closed early", "was ill" — and context you have to open is context
 * nobody reads while glancing at a week.
 *
 * There is no delete button: clearing the field is the gesture, and the action removes the row
 * rather than storing a blank one. A second control for the same act is a second thing to find.
 */
export function DayNote({
  owner,
  day,
  body,
  labels,
}: {
  owner: string | null;
  day: string;
  /** What is written now; empty when there is nothing. */
  body: string;
  labels: DayNoteLabels;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const icon =
    'tri-tap flex size-8 shrink-0 items-center justify-center rounded-lg disabled:opacity-40';

  if (editing) {
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const next = String(new FormData(event.currentTarget).get('body') ?? '');
          startTransition(async () => {
            const message = await setDayNoteAction(owner, day, next);
            setError(message);
            // Left open on a refusal, so what was typed is still there to correct.
            if (!message) setEditing(false);
          });
        }}
        onKeyDown={(event) => {
          // Stopped here, or the sheet a form sits in on a phone closes along with it.
          if (event.key !== 'Escape') return;
          event.stopPropagation();
          setEditing(false);
          setError(null);
        }}
        className="border-line mt-1 flex flex-col gap-1 border-t pt-2"
      >
        <textarea
          name="body"
          autoFocus
          rows={3}
          maxLength={2000}
          defaultValue={body}
          aria-label={labels.edit}
          placeholder={labels.placeholder}
          className="border-line bg-raised text-text placeholder:text-dim/60 w-full resize-y rounded-[10px] border px-2.5 py-2 text-[12px] leading-relaxed"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-dim/70 text-[10px]">{labels.clearHint}</span>
          <div className="flex items-center gap-1">
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
              className={`${icon} text-dim hover:text-text`}
            >
              <X size={15} aria-hidden />
            </button>
          </div>
        </div>
        {error ? <p className="text-neg text-[11px]">{error}</p> : null}
      </form>
    );
  }

  if (body === '') {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="tri-tap text-dim/70 hover:text-brand flex min-h-8 w-full items-center gap-1.5 rounded-lg text-[11px]"
      >
        <StickyNote size={12} aria-hidden />
        {labels.add}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      aria-label={labels.edit}
      /* The whole note is the target. It is small type in a small card, and a pencil beside it
         would be a 13px hit area next to a paragraph nobody can press. */
      className="border-line tri-tap mt-1 flex w-full items-start gap-1.5 border-t pt-2 text-start"
    >
      <StickyNote size={12} aria-hidden className="text-dim/70 mt-[3px] shrink-0" />
      <span className="text-dim min-w-0 flex-1 text-[11px] leading-relaxed whitespace-pre-wrap">
        {body}
      </span>
    </button>
  );
}
