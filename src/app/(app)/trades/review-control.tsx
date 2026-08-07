'use client';

import { Check, X } from 'lucide-react';
import { useEffect, useOptimistic, useRef, useState, useTransition } from 'react';
import { setTradeReviewAction } from './review-actions';

export type ReviewLabels = {
  tpTiming: string;
  originalTp: string;
  unset: string;
  timings: { early: string; onTime: string; late: string };
  answers: { yes: string; no: string };
  /** The two questions as sentences, for the phone sheet where there is no column to explain. */
  tpTimingQuestion: string;
  originalTpQuestion: string;
  sheetTitle: string;
  add: string;
  done: string;
  clear: string;
};

/**
 * The two exit questions, answerable from the trade's own row.
 *
 * On the row rather than only on the journal page because these get answered in a pass: a
 * trader goes down the week's trades and marks them off. Making that a page load each way
 * turns a two-minute review into a chore, and a review nobody does produces a pie chart that
 * describes nothing.
 *
 * **Two shapes, because only one of them has a column heading.** In the table the selects sit
 * under "Exit timing" and "Original profit target", so the control needs no label of its own.
 * On a phone there is no table and there were no labels either — two grey boxes reading "not
 * answered", on every row, with nothing anywhere saying what was being asked. Nobody answers a
 * question they cannot see, which is what nought of twenty-six answered looks like from the
 * outside.
 *
 * So the phone gets a chip that opens a sheet with both questions written out as sentences and
 * answered by buttons big enough to hit. It also costs one line instead of two, which is the
 * other thing wrong with a pair of dropdowns on a card.
 */
export function ReviewControl({
  tradeId,
  tpTiming,
  tookOriginalTp,
  labels,
}: {
  tradeId: string;
  tpTiming: 'early' | 'onTime' | 'late' | null;
  tookOriginalTp: boolean | null;
  labels: ReviewLabels;
}) {
  const [, startTransition] = useTransition();

  const [timing, setTiming] = useOptimistic(tpTiming === null ? '' : tpTiming);
  const [original, setOriginal] = useOptimistic(
    tookOriginalTp === null ? '' : tookOriginalTp ? 'yes' : 'no',
  );

  // A stable ref so a fast second change does not race the first back on screen.
  const pending = useRef(0);

  const save = (field: 'tpTiming' | 'tookOriginalTp', value: string) => {
    const data = new FormData();
    data.set('id', tradeId);
    data.set('field', field);
    data.set('value', value);

    const ticket = ++pending.current;
    startTransition(async () => {
      if (field === 'tpTiming') setTiming(value);
      else setOriginal(value);
      await setTradeReviewAction({}, data);
      // Nothing to do with the result: the action revalidates, and the server value takes
      // over on the next render. Only the newest change is allowed to win.
      if (ticket !== pending.current) return;
    });
  };

  const select =
    'border-line bg-raised text-text rounded-lg border px-1.5 py-1 text-[11px] leading-none';

  const timingLabel =
    timing === '' ? null : labels.timings[timing as 'early' | 'onTime' | 'late'];
  const originalLabel = original === '' ? null : labels.answers[original as 'yes' | 'no'];

  return (
    <>
      {/* The table, where the column headings are the labels. */}
      <div className="hidden items-center gap-1.5 md:flex">
        <select
          aria-label={labels.tpTiming}
          data-tip={labels.tpTiming}
          value={timing}
          onChange={(event) => save('tpTiming', event.target.value)}
          className={`${select} w-[5.5rem]`}
        >
          <option value="">{labels.unset}</option>
          <option value="early">{labels.timings.early}</option>
          <option value="onTime">{labels.timings.onTime}</option>
          <option value="late">{labels.timings.late}</option>
        </select>

        <select
          aria-label={labels.originalTp}
          data-tip={labels.originalTp}
          value={original}
          onChange={(event) => save('tookOriginalTp', event.target.value)}
          className={`${select} w-[4.5rem]`}
        >
          <option value="">{labels.unset}</option>
          <option value="yes">{labels.answers.yes}</option>
          <option value="no">{labels.answers.no}</option>
        </select>
      </div>

      <ReviewSheet
        labels={labels}
        timing={timing}
        original={original}
        timingLabel={timingLabel}
        originalLabel={originalLabel}
        onAnswer={save}
      />
    </>
  );
}

/**
 * The phone half: a chip that says what has been answered, and a sheet that asks.
 *
 * The chip is the whole disclosure. Unanswered it invites — one quiet outlined word — and
 * answered it reports, so a row that has been reviewed reads as reviewed without opening
 * anything.
 */
function ReviewSheet({
  labels,
  timing,
  original,
  timingLabel,
  originalLabel,
  onAnswer,
}: {
  labels: ReviewLabels;
  timing: string;
  original: string;
  timingLabel: string | null;
  originalLabel: string | null;
  onAnswer: (field: 'tpTiming' | 'tookOriginalTp', value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  const answered = timingLabel !== null || originalLabel !== null;

  /** One answer button. Selected is filled; pressing the selected one clears it. */
  const Option = ({
    field,
    value,
    current,
    children,
  }: {
    field: 'tpTiming' | 'tookOriginalTp';
    value: string;
    current: string;
    children: React.ReactNode;
  }) => {
    const on = current === value;
    return (
      <button
        type="button"
        aria-pressed={on}
        onClick={() => onAnswer(field, on ? '' : value)}
        className={`min-h-11 flex-1 rounded-[10px] border px-2 text-xs font-semibold transition-colors ${
          on ? 'bg-brand border-brand text-white' : 'border-line bg-raised text-text'
        }`}
      >
        {children}
      </button>
    );
  };

  return (
    <div className="md:hidden">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
          answered ? 'border-brand/40 bg-brand/10 text-brand' : 'border-line text-dim'
        }`}
      >
        {answered ? (
          <>
            <Check size={12} aria-hidden />
            {[timingLabel, originalLabel].filter(Boolean).join(' · ')}
          </>
        ) : (
          <>+ {labels.add}</>
        )}
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label={labels.done}
            onClick={close}
            className="fixed inset-0 z-40 bg-black/50"
          />
          <div
            ref={panel}
            tabIndex={-1}
            role="dialog"
            aria-modal
            aria-label={labels.sheetTitle}
            className="border-line bg-surface fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col gap-4 overflow-y-auto rounded-t-2xl border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-text text-sm font-bold">{labels.sheetTitle}</span>
              <button
                type="button"
                onClick={close}
                aria-label={labels.done}
                className="text-dim hover:text-text -m-2 inline-flex min-h-11 min-w-11 items-center justify-center"
              >
                <X size={18} aria-hidden />
              </button>
            </div>

            {/* The question as a sentence. This is the part the row never had room for, and
                the reason nobody was answering: a control nobody can read is a control nobody
                uses. */}
            <div className="flex flex-col gap-2">
              <p className="text-text text-xs font-semibold">{labels.tpTimingQuestion}</p>
              <div className="flex gap-2">
                <Option field="tpTiming" value="early" current={timing}>
                  {labels.timings.early}
                </Option>
                <Option field="tpTiming" value="onTime" current={timing}>
                  {labels.timings.onTime}
                </Option>
                <Option field="tpTiming" value="late" current={timing}>
                  {labels.timings.late}
                </Option>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-text text-xs font-semibold">{labels.originalTpQuestion}</p>
              <div className="flex gap-2">
                <Option field="tookOriginalTp" value="yes" current={original}>
                  {labels.answers.yes}
                </Option>
                <Option field="tookOriginalTp" value="no" current={original}>
                  {labels.answers.no}
                </Option>
              </div>
            </div>

            <button
              type="button"
              onClick={close}
              className="bg-brand inline-flex min-h-11 items-center justify-center rounded-[10px] px-4 text-sm font-bold text-white"
            >
              {labels.done}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
