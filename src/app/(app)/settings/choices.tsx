'use client';

import { useTransition } from 'react';
import type { Locale } from '@/i18n/config';
import {
  setAutoSyncAction,
  setDisplayStyleAction,
  setLocaleAction,
  setThemeAction,
} from '@/app/actions/preferences';
import { THEMES, type Theme } from '@/lib/theme';
import { DISPLAY_STYLES, type DisplayStyle } from '@/lib/display-style';

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
              active ? 'bg-brand font-bold text-on-brand' : 'text-dim font-medium'
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

/**
 * Which of the three visual languages the interface is drawn in.
 *
 * Its own control beside the theme rather than folded into it: these answer two different
 * questions — light-or-dark, and which look — and every style is drawn in both themes. One
 * row of six buttons would be asking both at once, and choosing a style would silently
 * decide whether the screen is dark.
 *
 * Resolved in CSS from `<html data-style>` for the same reason the theme is: deciding it in
 * JavaScript would paint one style on the server and correct it on the client.
 */
export function DisplayStyleChoice({
  current,
  labels,
}: {
  current: DisplayStyle;
  labels: Record<DisplayStyle, string>;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Toggle
      options={DISPLAY_STYLES.map((value) => [value, labels[value]] as const)}
      value={current}
      disabled={pending}
      onChange={(next) => startTransition(() => setDisplayStyleAction(next))}
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
