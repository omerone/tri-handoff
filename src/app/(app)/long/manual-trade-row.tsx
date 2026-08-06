'use client';

import { ArrowDownRight, ArrowUpRight, NotebookPen, Pencil, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import { Chip, Num } from '@/components/ui/kpi';
import { FormMessage, SubmitButton } from '@/components/ui/form';
import { DateField } from '@/components/ui/date-field';
import {
  deleteManualTradeAction,
  updateManualTradeAction,
  type ManualTradeFormState,
} from './manual-trade-actions';
import type { ManualTradeLabels } from './manual-trade-form';

/** Everything the row needs to draw itself, and to fill the form when it is opened. */
export type ManualTradeView = {
  id: string;
  symbol: string;
  assetClassLabel: string;
  direction: 'long' | 'short';
  directionLabel: string;
  style: 'day' | 'swing';
  closedAt: string;
  profit: string;
  profitPositive: boolean;
  risk: string | null;
  rr: string | null;
  rrPositive: boolean;
  journalled: boolean;
  /** The raw values, formatted for form inputs rather than for reading. */
  edit: {
    symbol: string;
    direction: 'long' | 'short';
    closeDate: string;
    openDate: string;
    profit: string;
    risk: string;
    volume: string;
    entryPrice: string;
    exitPrice: string;
    stopLoss: string;
    takeProfit: string;
    commission: string;
    swap: string;
  };
};

export type ManualTradeRowLabels = {
  journal: string;
  edit: string;
  cancel: string;
  save: string;
  delete: string;
  deleteConfirm: string;
  /** The field labels, shared with the add form so the two never disagree. */
  fields: ManualTradeLabels;
};

const field =
  'border-line bg-raised text-text placeholder:text-dim/60 rounded-[10px] border px-2.5 py-1.5 text-xs';

/**
 * One typed-in trade: read it, correct it, or remove it.
 *
 * The edit opens inline under the row rather than on its own page, matching the holdings
 * table beside it — a correction is usually one number, and a round trip to another screen to
 * change one number is how a journal stops getting corrected.
 *
 * Every field the add form offers is here, prefilled, including the ones behind the fold
 * there. Nothing is hidden on this path: someone who opened the editor is already looking for
 * a specific value, and a second click to reach it would be in the way rather than out of it.
 */
export function ManualTradeRow({
  trade,
  labels,
}: {
  trade: ManualTradeView;
  labels: ManualTradeRowLabels;
}) {
  const [editing, setEditing] = useState(false);
  const [state, action] = useActionState<ManualTradeFormState, FormData>(
    updateManualTradeAction,
    {},
  );

  /*
   * Closed on a successful save, and only then. Leaving it open after a failure keeps the
   * numbers the person typed in front of them next to the reason it did not save — closing
   * would discard both and leave them guessing what to retype.
   *
   * Keyed on the action result rather than on `state.notice` being truthy. The notice sticks
   * around after a save, so a plain truthiness check would slam the editor shut the instant it
   * was reopened — the row would be editable exactly once per page load. `state` is a fresh
   * object per submission, so this fires once per save and not again.
   */
  useEffect(() => {
    if (state.notice) setEditing(false);
  }, [state]);

  if (editing) {
    return (
      <tr className="border-line bg-raised/30 border-b">
        <td colSpan={8} className="px-3 py-3">
          <form action={action} className="flex flex-col gap-3">
            <input type="hidden" name="id" value={trade.id} />
            <input type="hidden" name="style" value={trade.style} />
            <FormMessage error={state.error} />

            <div className="flex flex-wrap items-end gap-2">
              <Field label={labels.fields.symbol}>
                <input
                  name="symbol"
                  defaultValue={trade.edit.symbol}
                  required
                  dir="ltr"
                  autoCapitalize="characters"
                  className={`${field} w-28`}
                />
              </Field>

              <Field label={labels.fields.direction}>
                <select
                  name="direction"
                  defaultValue={trade.edit.direction}
                  className={`${field} w-24`}
                >
                  <option value="long">{labels.fields.long}</option>
                  <option value="short">{labels.fields.short}</option>
                </select>
              </Field>

              <DateField
                name="closeDate"
                defaultValue={trade.edit.closeDate}
                label={labels.fields.date}
                required
                className={`${field} w-36`}
              />
              <DateField
                name="openDate"
                defaultValue={trade.edit.openDate}
                label={labels.fields.openDate}
                className={`${field} w-36`}
              />

              <Num_ name="profit" label={labels.fields.profit} value={trade.edit.profit} signed />
              <Num_ name="risk" label={labels.fields.risk} value={trade.edit.risk} />
              <Num_ name="volume" label={labels.fields.volume} value={trade.edit.volume} />
              <Num_ name="entryPrice" label={labels.fields.entryPrice} value={trade.edit.entryPrice} />
              <Num_ name="exitPrice" label={labels.fields.exitPrice} value={trade.edit.exitPrice} />
              <Num_ name="stopLoss" label={labels.fields.stopLoss} value={trade.edit.stopLoss} />
              <Num_ name="takeProfit" label={labels.fields.takeProfit} value={trade.edit.takeProfit} />
              <Num_ name="commission" label={labels.fields.commission} value={trade.edit.commission} signed />
              <Num_ name="swap" label={labels.fields.swap} value={trade.edit.swap} signed />
            </div>

            <div className="flex items-center gap-2">
              <SubmitButton>{labels.save}</SubmitButton>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="border-line text-dim hover:text-text rounded-[10px] border px-3 py-2 text-xs"
              >
                <span className="inline-flex items-center gap-1.5">
                  <X size={13} aria-hidden /> {labels.cancel}
                </span>
              </button>
            </div>
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-line border-b last:border-b-0">
      <td className="text-dim px-3 py-2.5 text-xs whitespace-nowrap">
        <Num>{trade.closedAt}</Num>
      </td>
      <td className="px-3 py-2.5 font-bold" dir="ltr">
        {trade.symbol}
      </td>
      <td className="px-3 py-2.5">
        <Chip>{trade.assetClassLabel}</Chip>
      </td>
      <td className="px-3 py-2.5">
        <span
          className={`inline-flex items-center gap-1 text-xs ${
            trade.direction === 'long' ? 'text-pos' : 'text-neg'
          }`}
        >
          {trade.direction === 'long' ? (
            <ArrowUpRight size={13} aria-hidden />
          ) : (
            <ArrowDownRight size={13} aria-hidden />
          )}
          {trade.directionLabel}
        </span>
      </td>
      <td className="px-3 py-2.5 text-xs">
        <Num>{trade.risk ?? '—'}</Num>
      </td>
      <td className="px-3 py-2.5">
        {/* No stop given, so no R — shown as absent rather than as 0R, which would read as a
            break-even trade. The same rule the trades table follows. */}
        {trade.rr === null ? (
          <Chip tone="dim">—</Chip>
        ) : (
          <Chip tone={trade.rrPositive ? 'pos' : 'neg'}>
            <Num>{trade.rr}</Num>
          </Chip>
        )}
      </td>
      <td className={`px-3 py-2.5 font-bold ${trade.profitPositive ? 'text-pos' : 'text-neg'}`}>
        <Num>{trade.profit}</Num>
      </td>
      <td className="px-3 py-2.5 text-end">
        <span className="inline-flex items-center gap-1.5">
          <Link
            href={`/trades/${trade.id}`}
            aria-label={labels.journal}
            data-tip={labels.journal}
            className={`inline-flex p-1 ${trade.journalled ? 'text-brand' : 'text-dim/50 hover:text-text'}`}
          >
            <NotebookPen size={14} aria-hidden />
          </Link>

          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label={labels.edit}
            data-tip={labels.edit}
            className="text-dim/60 hover:text-text inline-flex p-1"
          >
            <Pencil size={14} aria-hidden />
          </button>

          <form action={deleteManualTradeAction} className="inline-flex">
            <input type="hidden" name="id" value={trade.id} />
            <button
              type="submit"
              aria-label={labels.delete}
              data-tip={labels.delete}
              onClick={(event) => {
                if (!window.confirm(labels.deleteConfirm)) event.preventDefault();
              }}
              className="text-dim/60 hover:text-neg inline-flex p-1"
            >
              <Trash2 size={14} aria-hidden />
            </button>
          </form>
        </span>
      </td>
    </tr>
  );
}

function Num_({
  name,
  label,
  value,
  signed = false,
}: {
  name: string;
  label: string;
  value: string;
  signed?: boolean;
}) {
  return (
    <Field label={label}>
      <input
        name={name}
        type="number"
        step="any"
        defaultValue={value}
        {...(signed ? {} : { min: '0' })}
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
