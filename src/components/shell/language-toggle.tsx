'use client';

import { useTransition } from 'react';
import type { Locale } from '@/i18n/config';
import { setLocaleAction } from '@/app/actions/preferences';

/** The prototype's one-tap "EN ⇄ עב" switch, which flips both the language and the direction. */
export function LanguageToggle({ current }: { current: Locale }) {
  const [pending, startTransition] = useTransition();
  const next: Locale = current === 'he' ? 'en' : 'he';

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => setLocaleAction(next))}
      aria-label={next === 'en' ? 'Switch to English' : 'החלף לעברית'}
      className="border-line bg-raised text-text rounded-full border px-3 py-1.5 text-xs disabled:opacity-60"
    >
      {next === 'en' ? 'EN' : 'עב'}
    </button>
  );
}
