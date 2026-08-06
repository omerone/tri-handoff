'use client';

import { useTransition } from 'react';
import type { Locale } from '@/i18n/config';
import { CURRENCY_SYMBOL, SUPPORTED_CURRENCIES, type Currency } from '@/lib/money/currency';
import {
  setAutoSyncAction,
  setDisplayCurrencyAction,
  setLocaleAction,
  setThemeAction,
} from '@/app/actions/preferences';
import { THEMES, type Theme } from '@/lib/theme';

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

/**
 * Dark, light or follow the system (SPEC §1.1).
 *
 * `system` is resolved entirely in CSS — see globals.css. Deciding it in JavaScript would
 * mean the server rendering one theme and the client correcting it, which is a visible flash
 * on every single page load.
 */
export function ThemeChoice({
  current,
  labels,
}: {
  current: Theme;
  labels: Record<Theme, string>;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Toggle
      options={THEMES.map((value) => [value, labels[value]] as const)}
      value={current}
      disabled={pending}
      onChange={(next) => startTransition(() => setThemeAction(next))}
    />
  );
}

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

/**
 * Whether a login pulls from the broker on its own.
 *
 * Off by default, which is why the "off" label carries the reason: a trader who never opens
 * this card should still understand, when they notice the refresh button is the only thing
 * that updates anything, that this is deliberate and where it is decided.
 */
export function AutoSyncChoice({
  current,
  labels,
}: {
  current: boolean;
  labels: { on: string; off: string };
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Toggle
      options={[
        ['off', labels.off],
        ['on', labels.on],
      ]}
      value={current ? 'on' : 'off'}
      disabled={pending}
      onChange={(next) => startTransition(() => setAutoSyncAction(next === 'on'))}
    />
  );
}
