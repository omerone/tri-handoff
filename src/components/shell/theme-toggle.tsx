'use client';

import { useTransition } from 'react';
import { Moon, Sun } from 'lucide-react';
import type { Theme } from '@/lib/theme';
import { setThemeAction } from '@/app/actions/preferences';

export function ThemeToggle({ current }: { current: Theme }) {
  const [pending, startTransition] = useTransition();
  const next: Theme = current === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => setThemeAction(next))}
      aria-label={next === 'light' ? 'Switch to light mode' : 'Switch to dark mode'}
      className="tri-tap border-line bg-raised text-text rounded-full border p-2 disabled:opacity-60"
      data-tip={next === 'light' ? 'Light mode' : 'Dark mode'}
    >
      {current === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
