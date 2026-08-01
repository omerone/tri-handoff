'use client';

import { useTransition } from 'react';
import type { Locale } from '@/i18n/config';
import { CURRENCY_SYMBOL, SUPPORTED_CURRENCIES, type Currency } from '@/lib/money/currency';
import { setDisplayCurrencyAction, setLocaleAction } from '@/app/actions/preferences';

/** The prototype's segmented toggle. */
function Toggle<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="border-line bg-raised inline-flex gap-1 rounded-[10px] border p-[3px]">
      {options.map(([key, label]) => {
        const active = key === value;
        return (
          <button
            key={key}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onChange(key)}
            className={`rounded-lg px-3 py-1.5 text-[13px] disabled:opacity-60 ${
              active ? 'bg-brand font-bold text-white' : 'text-dim font-medium'
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

const LANGUAGES = [
  ['he', 'עברית'],
  ['en', 'English'],
] as const satisfies readonly (readonly [Locale, string])[];

export function LanguageChoice({ current }: { current: Locale }) {
  const [pending, startTransition] = useTransition();
  return (
    <Toggle
      options={LANGUAGES}
      value={current}
      disabled={pending}
      onChange={(next) => startTransition(() => setLocaleAction(next))}
    />
  );
}

const CURRENCIES = SUPPORTED_CURRENCIES.map(
  (code) => [code, `${CURRENCY_SYMBOL[code]} ${code}`] as const,
);

export function CurrencyChoice({ current }: { current: Currency }) {
  const [pending, startTransition] = useTransition();
  return (
    <Toggle
      options={CURRENCIES}
      value={current}
      disabled={pending}
      onChange={(next) => startTransition(() => setDisplayCurrencyAction(next))}
    />
  );
}
