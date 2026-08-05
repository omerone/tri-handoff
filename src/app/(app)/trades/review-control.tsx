'use client';

import { useOptimistic, useRef, useTransition } from 'react';
import { setTradeReviewAction } from './review-actions';

export type ReviewLabels = {
  tpTiming: string;
  originalTp: string;
  unset: string;
  timings: { early: string; onTime: string; late: string };
  answers: { yes: string; no: string };
};

/**
 * The two exit questions, answerable from the trade's own row.
 *
 * On the row rather than only on the journal page because these get answered in a pass: a
 * trader goes down the week's trades and marks them off. Making that a page load each way
 * turns a two-minute review into a chore, and a review nobody does produces a pie chart that
 * describes nothing.
 *
 * Each select saves on change with no submit button. There are two options and three options;
 * a confirm step for a value that is one click to correct is friction without a purpose. The
 * optimistic value keeps the choice on screen while the server round-trips, so the control
 * never appears to snap back to the old answer.
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

  return (
    <div className="flex items-center gap-1.5">
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
  );
}
