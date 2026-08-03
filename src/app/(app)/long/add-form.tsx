'use client';

import { useActionState, useState } from 'react';
import { Plus } from 'lucide-react';
import { DateField } from '@/components/ui/date-field';
import { FormMessage, SubmitButton } from '@/components/ui/form';
import { createPositionAction, type PositionFormState } from './actions';
import { SymbolField, type SymbolFieldLabels, type SymbolMatchView } from './symbol-field';

export type AddFormLabels = SymbolFieldLabels & {
  qty: string;
  buyPrice: string;
  buyDate: string;
  fees: string;
  currency: string;
  add: string;
};

const field =
  'border-line bg-raised text-text placeholder:text-dim/60 rounded-[10px] border px-3 py-2 text-sm';

export function AddPositionForm({
  labels,
  currencies,
  defaultDate,
}: {
  labels: AddFormLabels;
  currencies: readonly string[];
  /** Today, formatted on the server so the field does not depend on the client's clock. */
  defaultDate: string;
}) {
  const [state, action] = useActionState<PositionFormState, FormData>(createPositionAction, {});
  // Follows the picked listing: Apple on the LSE is quoted in pounds, and a position saved in
  // dollars because that was the default would never be marked to market — the refresh
  // refuses to apply a quote in a currency the position is not held in.
  const [currency, setCurrency] = useState('USD');

  const onPick = (match: SymbolMatchView | null) => {
    if (match) setCurrency(match.currency);
  };

  return (
    <form action={action} className="flex flex-col gap-3">
      <FormMessage error={state.error} />

      <div className="flex flex-wrap items-end gap-2">
        <SymbolField labels={labels} onPick={onPick} />

        <Field label={labels.qty}>
          <input
            name="qty"
            type="number"
            step="any"
            min="0"
            required
            dir="ltr"
            className={`${field} w-24`}
          />
        </Field>

        <Field label={labels.buyPrice}>
          <input
            name="buyPrice"
            type="number"
            step="any"
            min="0"
            required
            dir="ltr"
            className={`${field} w-28`}
          />
        </Field>

        <Field label={labels.fees}>
          <input
            name="fees"
            type="number"
            step="any"
            min="0"
            defaultValue={0}
            dir="ltr"
            className={`${field} w-24`}
          />
        </Field>

        <Field label={labels.currency}>
          <select
            name="currency"
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
            className={`${field} w-24`}
          >
            {currencies.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </Field>

        <DateField
          name="buyDate"
          defaultValue={defaultDate}
          label={labels.buyDate}
          required
          className={`${field} w-40`}
        />

        <SubmitButton>
          <span className="inline-flex items-center gap-1.5">
            <Plus size={14} aria-hidden /> {labels.add}
          </span>
        </SubmitButton>
      </div>
    </form>
  );
}

function Field({
  label,
  children,
  className = '',
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-dim text-[11px] font-semibold">{label}</span>
      {children}
    </label>
  );
}
