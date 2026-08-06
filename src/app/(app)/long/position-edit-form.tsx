'use client';

import { X } from 'lucide-react';
import { useActionState, useEffect } from 'react';
import { DateField } from '@/components/ui/date-field';
import { FormMessage, SubmitButton } from '@/components/ui/form';
import { updatePositionAction, type PositionFormState } from './actions';

/** The stored values, as strings a form input will accept. */
export type PositionEditValues = {
  symbol: string;
  qty: string;
  buyPrice: string;
  buyDate: string;
  fees: string;
  currency: string;
  currentPrice: string;
  /** Empty on an open position. Both move together — see the action. */
  sellPrice: string;
  closeDate: string;
};

export type PositionEditLabels = {
  symbol: string;
  qty: string;
  buyPrice: string;
  buyDate: string;
  fees: string;
  currency: string;
  currentPrice: string;
  sellPrice: string;
  closeDate: string;
  closeHint: string;
  save: string;
  cancel: string;
};

const field =
  'border-line bg-raised text-text rounded-[10px] border px-2.5 py-1.5 text-xs';

/**
 * Correcting a holding, inline where it sits.
 *
 * A holding has no broker behind it — every number on it was typed by the person reading it,
 * so every number is theirs to fix. The screen already had three narrow paths for changing
 * one thing each (mark the price, close it, delete it); this is the one for "I entered it
 * wrong", which none of those could do.
 *
 * The close is two fields and they move together. Filling both closes the position at that
 * price on that date and derives the realised P&L from the corrected buy price; clearing both
 * reopens it, which is the only way back from a mis-clicked "close". The realised figure is
 * never typed — see the action for why.
 */
export function PositionEditForm({
  id,
  values,
  currencies,
  labels,
  onDone,
}: {
  id: string;
  values: PositionEditValues;
  currencies: readonly string[];
  labels: PositionEditLabels;
  onDone: () => void;
}) {
  const [state, action] = useActionState<PositionFormState, FormData>(updatePositionAction, {});

  /*
   * Closed on a successful save only. Keyed on the action result rather than on `ok` being
   * truthy: the flag sticks around, so a plain check would slam the editor shut the instant it
   * was reopened. In an effect rather than during render, because `onDone` sets state in the
   * parent and doing that mid-render is the parent re-rendering underneath its own child.
   */
  useEffect(() => {
    if (state.ok) onDone();
    // `onDone` is a fresh closure each render; the action result is what should re-fire this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={action} className="flex flex-col gap-3">
      <FormMessage error={state.error} />
      <input type="hidden" name="id" value={id} />

      <div className="flex flex-wrap items-end gap-2">
        <Field label={labels.symbol}>
          <input
            name="symbol"
            defaultValue={values.symbol}
            required
            dir="ltr"
            autoCapitalize="characters"
            className={`${field} w-28`}
          />
        </Field>
        <Num name="qty" label={labels.qty} value={values.qty} />
        <Num name="buyPrice" label={labels.buyPrice} value={values.buyPrice} />
        <DateField
          name="buyDate"
          defaultValue={values.buyDate}
          label={labels.buyDate}
          required
          className={`${field} w-36`}
        />
        <Num name="fees" label={labels.fees} value={values.fees} />

        <Field label={labels.currency}>
          <select name="currency" defaultValue={values.currency} className={`${field} w-20`}>
            {currencies.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </Field>

        <Num name="currentPrice" label={labels.currentPrice} value={values.currentPrice} />
      </div>

      <div>
        <p className="text-dim mb-2 text-[11px] leading-relaxed">{labels.closeHint}</p>
        <div className="flex flex-wrap items-end gap-2">
          <Num name="sellPrice" label={labels.sellPrice} value={values.sellPrice} />
          <DateField
            name="closeDate"
            defaultValue={values.closeDate}
            label={labels.closeDate}
            className={`${field} w-36`}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <SubmitButton>{labels.save}</SubmitButton>
        <button
          type="button"
          onClick={onDone}
          className="border-line text-dim hover:text-text rounded-[10px] border px-3 py-2 text-xs"
        >
          <span className="inline-flex items-center gap-1.5">
            <X size={13} aria-hidden /> {labels.cancel}
          </span>
        </button>
      </div>
    </form>
  );
}

function Num({ name, label, value }: { name: string; label: string; value: string }) {
  return (
    <Field label={label}>
      <input
        name={name}
        type="number"
        step="any"
        min="0"
        defaultValue={value}
        dir="ltr"
        className={`${field} w-24`}
      />
    </Field>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-dim text-[10px] font-semibold">{label}</span>
      {children}
    </label>
  );
}
