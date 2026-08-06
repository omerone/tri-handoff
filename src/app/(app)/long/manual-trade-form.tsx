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

const field =
  'border-line bg-raised text-text placeholder:text-dim/60 rounded-[10px] border px-3 py-2 text-sm';

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

      <div className="flex flex-wrap items-end gap-2">
        <Field label={labels.symbol}>
          <input
            name="symbol"
            required
            dir="ltr"
            autoCapitalize="characters"
            placeholder={labels.symbolHint}
            className={`${field} w-32`}
          />
        </Field>

        <Field label={labels.direction}>
          <select name="direction" defaultValue="long" className={`${field} w-28`}>
            <option value="long">{labels.long}</option>
            <option value="short">{labels.short}</option>
          </select>
        </Field>

        <DateField
          name="closeDate"
          defaultValue={defaultDate}
          label={labels.date}
          required
          className={`${field} w-40`}
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
            className={`${field} w-28`}
          />
        </Field>

        <Field label={labels.risk}>
          <input
            name="risk"
            type="number"
            step="any"
            min="0"
            dir="ltr"
            placeholder={labels.riskHint}
            className={`${field} w-28`}
          />
        </Field>

        <SubmitButton>
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
          <div className="flex flex-wrap items-end gap-2">
            <DateField
              name="openDate"
              defaultValue={defaultDate}
              label={labels.openDate}
              className={`${field} w-40`}
            />
            <Num name="volume" label={labels.volume} width="w-24" />
            <Num name="entryPrice" label={labels.entryPrice} width="w-28" />
            <Num name="exitPrice" label={labels.exitPrice} width="w-28" />
            <Num name="stopLoss" label={labels.stopLoss} width="w-28" />
            <Num name="takeProfit" label={labels.takeProfit} width="w-28" />
            <Num name="commission" label={labels.commission} width="w-24" signed />
            <Num name="swap" label={labels.swap} width="w-24" signed />
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-dim text-[11px] font-semibold">{label}</span>
      {children}
    </label>
  );
}
