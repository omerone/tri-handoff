'use client';

import { useActionState, useState } from 'react';
import { Check, Clock, Trash2, TriangleAlert, X } from 'lucide-react';
import { Num } from '@/components/ui/kpi';
import {
  closePositionAction,
  deletePositionAction,
  updatePriceAction,
  type PositionFormState,
} from './actions';

export type PositionRowLabels = {
  /** The column headings, repeated on each cell so the mobile card layout can label them. */
  columns: {
    qty: string;
    buyPrice: string;
    currentValue: string;
    value: string;
    unrealized: string;
    updated: string;
  };
  update: string;
  newPrice: string;
  close: string;
  closeTitle: string;
  sellPrice: string;
  delete: string;
  deleteConfirm: string;
  updated: string;
  cancel: string;
};

export type PositionRowData = {
  id: string;
  symbol: string;
  qty: string;
  buyPrice: string;
  currentPrice: string;
  /** Raw number, so the price field can be prefilled with something editable. */
  currentPriceValue: number;
  value: string;
  unrealized: string;
  unrealizedPositive: boolean;
  unrealizedPercent: string;
  updatedAt: string;
  /** Preformatted warning when the price is old, null when it is fresh. */
  staleMessage: string | null;
  closed: boolean;
  realized: string | null;
  realizedPositive: boolean;
};

const cell = 'px-3 py-2.5';
const input =
  'border-line bg-raised text-text rounded-lg border px-2 py-1 text-xs w-24';

export function PositionRow({
  position,
  labels,
}: {
  position: PositionRowData;
  labels: PositionRowLabels;
}) {
  const [mode, setMode] = useState<'idle' | 'price' | 'close'>('idle');

  return (
    <tr className="border-line border-b last:border-b-0">
      <td data-title className={`${cell} font-bold`}>
        {position.symbol}
        {position.closed ? <span className="text-dim ms-2 text-[10px]">·</span> : null}
      </td>
      <td data-label={labels.columns.qty} className={cell}>
        <Num className="text-xs">{position.qty}</Num>
      </td>
      <td data-label={labels.columns.buyPrice} className={cell}>
        <Num className="text-xs">{position.buyPrice}</Num>
      </td>

      <td data-label={labels.columns.currentValue} className={cell}>
        {mode === 'price' ? (
          <PriceForm
            id={position.id}
            defaultValue={position.currentPriceValue}
            labels={labels}
            onDone={() => setMode('idle')}
          />
        ) : (
          <div className="flex items-center gap-2">
            <Num className="text-xs">{position.currentPrice}</Num>
            {position.closed ? null : (
              <button
                type="button"
                onClick={() => setMode('price')}
                className="border-line bg-raised text-brand rounded-lg border px-2 py-1 text-[11px]"
              >
                {labels.update}
              </button>
            )}
          </div>
        )}
      </td>

      <td data-label={labels.columns.value} className={cell}>
        <Num className="text-xs">{position.value}</Num>
      </td>

      <td data-label={labels.columns.unrealized} className={cell}>
        {position.closed ? (
          <span className={`font-bold ${position.realizedPositive ? 'text-pos' : 'text-neg'}`}>
            <Num>{position.realized ?? '—'}</Num>
          </span>
        ) : (
          <div className={`font-bold ${position.unrealizedPositive ? 'text-pos' : 'text-neg'}`}>
            <Num>{position.unrealized}</Num>
            <span className="text-dim ms-1 text-[11px] font-normal">
              <Num>{position.unrealizedPercent}</Num>
            </span>
          </div>
        )}
      </td>

      <td data-label={labels.columns.updated} className={`${cell} text-dim text-[11px]`}>
        <span className="inline-flex items-center gap-1">
          {position.staleMessage ? (
            <TriangleAlert size={11} className="text-warn" aria-hidden />
          ) : (
            <Clock size={11} aria-hidden />
          )}
          <Num>{position.updatedAt}</Num>
        </span>
        {position.staleMessage ? (
          <div className="text-warn mt-0.5 text-[10px]">{position.staleMessage}</div>
        ) : null}
      </td>

      <td className={cell}>
        <div className="flex items-center justify-end gap-1.5">
          {mode === 'close' ? (
            <CloseForm id={position.id} labels={labels} onDone={() => setMode('idle')} />
          ) : (
            <>
              {position.closed ? null : (
                <button
                  type="button"
                  onClick={() => setMode('close')}
                  className="border-line bg-raised text-dim hover:text-text rounded-lg border px-2 py-1 text-[11px]"
                >
                  {labels.close}
                </button>
              )}
              <form action={deletePositionAction}>
                <input type="hidden" name="id" value={position.id} />
                <button
                  type="submit"
                  title={labels.delete}
                  aria-label={labels.delete}
                  onClick={(event) => {
                    if (!window.confirm(labels.deleteConfirm)) event.preventDefault();
                  }}
                  className="text-dim hover:text-neg p-1"
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              </form>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

function PriceForm({
  id,
  defaultValue,
  labels,
  onDone,
}: {
  id: string;
  defaultValue: number;
  labels: PositionRowLabels;
  onDone: () => void;
}) {
  const [state, action] = useActionState<PositionFormState, FormData>(async (prev, formData) => {
    const result = await updatePriceAction(prev, formData);
    if (result.ok) onDone();
    return result;
  }, {});

  return (
    <form action={action} className="flex items-center gap-1">
      <input type="hidden" name="id" value={id} />
      <input
        name="currentPrice"
        type="number"
        step="any"
        min="0"
        required
        autoFocus
        dir="ltr"
        defaultValue={defaultValue}
        aria-label={labels.newPrice}
        aria-invalid={state.error ? true : undefined}
        className={input}
      />
      <button type="submit" title={labels.update} aria-label={labels.update} className="text-pos p-1">
        <Check size={14} aria-hidden />
      </button>
      <button
        type="button"
        onClick={onDone}
        title={labels.cancel}
        aria-label={labels.cancel}
        className="text-dim p-1"
      >
        <X size={14} aria-hidden />
      </button>
    </form>
  );
}

function CloseForm({
  id,
  labels,
  onDone,
}: {
  id: string;
  labels: PositionRowLabels;
  onDone: () => void;
}) {
  const [, action] = useActionState<PositionFormState, FormData>(async (prev, formData) => {
    const result = await closePositionAction(prev, formData);
    if (result.ok) onDone();
    return result;
  }, {});

  return (
    <form action={action} className="flex items-center gap-1">
      <input type="hidden" name="id" value={id} />
      <input
        name="sellPrice"
        type="number"
        step="any"
        min="0"
        required
        autoFocus
        dir="ltr"
        aria-label={labels.sellPrice}
        placeholder={labels.sellPrice}
        className={input}
      />
      <button
        type="submit"
        title={labels.closeTitle}
        aria-label={labels.closeTitle}
        className="text-pos p-1"
      >
        <Check size={14} aria-hidden />
      </button>
      <button
        type="button"
        onClick={onDone}
        title={labels.cancel}
        aria-label={labels.cancel}
        className="text-dim p-1"
      >
        <X size={14} aria-hidden />
      </button>
    </form>
  );
}
