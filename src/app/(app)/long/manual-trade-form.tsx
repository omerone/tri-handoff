'use client';

import { ChevronDown, Plus } from 'lucide-react';
import { useActionState, useState } from 'react';
import { DateField } from '@/components/ui/date-field';
import { FormMessage, SubmitButton } from '@/components/ui/form';
import { createManualTradeAction, type ManualTradeFormState } from './manual-trade-actions';

export type ManualTradeLabels = {
  symbol: string;
  symbolHint: string;
  direction: string;
  long: string;
  short: string;
  date: string;
  profit: string;
  risk: string;
  riskHint: string;
  add: string;
  more: string;
  openDate: string;
  volume: string;
  entryPrice: string;
  exitPrice: string;
  stopLoss: string;
  takeProfit: string;
  commission: string;
  swap: string;
  moreHint: string;
};

/*
 * `min-h-11` is 44px — the size a finger actually hits, and the one number in here that is not
 * taste. It relaxes to the denser desktop height from `sm`, where the pointer is a mouse.
 * `w-full` because every field now sits in a grid cell and the cell decides the width; the
 * fixed widths these used to carry are what made the row wrap into a ragged staircase on a
 * phone, with the submit button washing up beside whichever field ended a line.
 */
const field =
  'border-line bg-raised text-text placeholder:text-dim/60 min-h-11 w-full rounded-[10px] border px-3 py-2 text-sm sm:min-h-9 sm:w-auto';

/**
 * Typing in a trade the broker will never tell us about.
 *
 * One row of the things every trader knows without looking anything up — what, which way,
 * when, and how it went — and a fold for the rest. The split is not cosmetic: a form that
 * demands an entry price and a contract volume before it will accept anything is a form
 * nobody fills in twice, and the whole point of this screen is that the journal works before
 * a broker is connected.
 *
 * The advanced fields are not decoration either. Give it entry, stop and volume and the risk
 * is computed with the same function the sync uses, so the R multiple on a hand-typed trade
 * means what it means everywhere else. Give it neither and the trade still counts toward
 * every figure that does not need an R.
 */
export function ManualTradeForm({
  labels,
  style,
  defaultDate,
}: {
  labels: ManualTradeLabels;
  /** Fixed by the tab the form is on, so it is a hidden field rather than another dropdown. */
  style: 'day' | 'swing';
  /** Today, formatted on the server so the field does not depend on the client's clock. */
  defaultDate: string;
}) {
  const [state, action] = useActionState<ManualTradeFormState, FormData>(
    createManualTradeAction,
    {},
  );
  const [open, setOpen] = useState(false);

  return (
    <form action={action} className="flex flex-col gap-3">
      <FormMessage error={state.error} notice={state.notice} />
      <input type="hidden" name="style" value={style} />

      {/*
        Two columns on a phone, the original inline row from `sm`.

        `flex-wrap` put the fields where they fell: five fixed widths against a 380px screen
        wrapped into uneven rows, and the submit button — the last flex child — ended up
        sharing a line with the risk box, which reads as an accident rather than a layout.
        A grid gives every field the same width and the button a row of its own.
      */}
      <div className="grid grid-cols-2 items-end gap-x-2 gap-y-3 sm:flex sm:flex-wrap sm:gap-2">
        <Field label={labels.symbol}>
          <input
            name="symbol"
            required
            dir="ltr"
            autoCapitalize="characters"
            placeholder={labels.symbolHint}
            className={`${field} sm:w-32`}
          />
        </Field>

        <Field label={labels.direction}>
          <select name="direction" defaultValue="long" className={`${field} sm:w-28`}>
            <option value="long">{labels.long}</option>
            <option value="short">{labels.short}</option>
          </select>
        </Field>

        <DateField
          name="closeDate"
          defaultValue={defaultDate}
          label={labels.date}
          required
          className={`${field} sm:w-40`}
        />

        <Field label={labels.profit}>
          {/*
            Signed, and no `min`: a losing trade is the more important half of a journal, and a
            form that will not accept a negative number is one that quietly collects only wins.
          */}
          <input
            name="profit"
            type="number"
            step="any"
            required
            dir="ltr"
            className={`${field} sm:w-28`}
          />
        </Field>

        {/* Spans the row: five fields over two columns leaves the last one beside an empty
            cell, which reads as a field that failed to load rather than the end of the form. */}
        <Field label={labels.risk} className="col-span-2 sm:col-auto">
          <input
            name="risk"
            type="number"
            step="any"
            min="0"
            dir="ltr"
            placeholder={labels.riskHint}
            className={`${field} sm:w-28`}
          />
        </Field>

        {/* Its own row, spanning both columns — the primary action of the form should not be
            something you find beside a number box. */}
        <SubmitButton className="col-span-2 w-full sm:col-auto sm:w-auto">
          <span className="inline-flex items-center gap-1.5">
            <Plus size={14} aria-hidden /> {labels.add}
          </span>
        </SubmitButton>
      </div>

      <div>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="text-dim hover:text-text inline-flex items-center gap-1 text-[11px] font-semibold"
        >
          <ChevronDown
            size={13}
            aria-hidden
            className={`transition-transform ${open ? 'rotate-180' : ''}`}
          />
          {labels.more}
        </button>

        {/*
          Kept mounted and hidden rather than unmounted, so anything typed into it survives a
          fold — and, more to the point, still submits. A collapsed section that silently drops
          the entry price someone just typed is worse than not having one.
        */}
        <div className={open ? 'mt-3' : 'hidden'}>
          <p className="text-dim mb-2 text-[11px] leading-relaxed">{labels.moreHint}</p>
          {/* The same grid as the row above, so the fold does not change the shape of the form
              underneath it — eight boxes wrapping raggedly is exactly what this section is
              most at risk of, since it has the most of them. */}
          <div className="grid grid-cols-2 items-end gap-x-2 gap-y-3 sm:flex sm:flex-wrap sm:gap-2">
            {/*
              Empty by default, not today — and this section being kept mounted is exactly why
              it matters. A pre-filled open date submits whether or not anyone opened the fold,
              so defaulting it to today rejected every trade closed before today with "the open
              date is later than the close date", naming a field the user could not see. That
              is the ordinary case for a journal: you write a trade down after you took it.
              Left empty, the action falls back to the close date, which is right for a day
              trade and honest for a swing one until someone says otherwise.
            */}
            <DateField
              name="openDate"
              defaultValue=""
              label={labels.openDate}
              className={`${field} sm:w-40`}
            />
            <Num name="volume" label={labels.volume} width="sm:w-24" />
            <Num name="entryPrice" label={labels.entryPrice} width="sm:w-28" />
            <Num name="exitPrice" label={labels.exitPrice} width="sm:w-28" />
            <Num name="stopLoss" label={labels.stopLoss} width="sm:w-28" />
            <Num name="takeProfit" label={labels.takeProfit} width="sm:w-28" />
            <Num name="commission" label={labels.commission} width="sm:w-24" signed />
            <Num name="swap" label={labels.swap} width="sm:w-24" signed />
          </div>
        </div>
      </div>
    </form>
  );
}

function Num({
  name,
  label,
  width,
  signed = false,
}: {
  name: string;
  label: string;
  width: string;
  /** Costs can be a credit, so those two accept a minus sign. Prices and volume cannot. */
  signed?: boolean;
}) {
  return (
    <Field label={label}>
      <input
        name={name}
        type="number"
        step="any"
        {...(signed ? {} : { min: '0' })}
        dir="ltr"
        className={`${field} ${width}`}
      />
    </Field>
  );
}

function Field({
  label,
  children,
  className = '',
}: {
  label: string;
  children: React.ReactNode;
  /** Lets a field claim the whole row — see the risk box, which would otherwise sit alone. */
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-dim text-[11px] font-semibold">{label}</span>
      {children}
    </label>
  );
}
