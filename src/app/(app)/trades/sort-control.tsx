'use client';

import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import type { SortKey, SortOrder } from './rows';

/**
 * How the table is ordered, written to the URL beside the filters.
 *
 * Two ways in, one piece of state. The column headings are the obvious place to sort a table
 * from and are the only place a mouse looks for it — but below the tablet breakpoint there is
 * no table, the rows are cards, and the headings do not exist. A dropdown covers that, and
 * covers the columns a heading cannot: on a phone there is nowhere to click for "biggest R".
 *
 * Both write the same two search params, so they cannot drift out of step with each other or
 * with what the server actually sorted by — there is no local state here to disagree with the
 * URL, which is the whole reason the sort lives there rather than in a client component.
 */

/** Neither control writes the default, so an unsorted URL stays clean. */
function useSortLink() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const apply = (key: SortKey, order: SortOrder) => {
    const next = new URLSearchParams(params.toString());
    if (key === 'closeAt' && order === 'desc') {
      next.delete('sort');
      next.delete('order');
    } else {
      next.set('sort', key);
      next.set('order', order);
    }
    // Same rule as the filters: page 7 of a re-ordered table is a different set of rows, and
    // landing there reads as "these are your best trades" when they are your 240th best.
    next.delete('page');

    const query = next.toString();
    startTransition(() => router.push(query ? `${pathname}?${query}` : pathname));
  };

  return { apply, pending };
}

/**
 * A column heading that sorts.
 *
 * Pressing the column already sorted reverses it; pressing a different one starts it at the
 * order that answers the question people ask of that column. Money, R and risk open at
 * largest-first, because "show me my biggest" is what a trader means by sorting on them, and a
 * date opens at newest. A symbol opens A→Z, where the alphabet is the question.
 */
export function SortHeader({
  label,
  sortKey,
  current,
  className = '',
}: {
  label: string;
  sortKey: SortKey;
  current: { key: SortKey; order: SortOrder };
  className?: string;
}) {
  const { apply, pending } = useSortLink();
  const active = current.key === sortKey;
  const opensDescending = sortKey !== 'symbol';
  const next: SortOrder = active
    ? current.order === 'asc'
      ? 'desc'
      : 'asc'
    : opensDescending
      ? 'desc'
      : 'asc';

  const Icon = !active ? ArrowUpDown : current.order === 'asc' ? ArrowUp : ArrowDown;

  return (
    <button
      type="button"
      onClick={() => apply(sortKey, next)}
      disabled={pending}
      className={`hover:text-text inline-flex items-center gap-1 disabled:opacity-60 ${
        active ? 'text-text font-semibold' : ''
      } ${className}`}
    >
      {label}
      {/* The idle arrows are faint rather than absent: a heading that only shows it can be
          sorted once it has been is a control nobody finds. */}
      <Icon size={11} aria-hidden className={active ? '' : 'opacity-35'} />
    </button>
  );
}

/** The same ordering as a dropdown, for the viewport with no column headings to press. */
export function SortSelect({
  current,
  label,
  options,
}: {
  current: { key: SortKey; order: SortOrder };
  label: string;
  /** `[key, order, label]` — each direction is its own entry, because "newest" and "oldest"
      are two answers a person picks between, not one choice plus a modifier. */
  options: readonly (readonly [SortKey, SortOrder, string])[];
}) {
  const { apply, pending } = useSortLink();
  const value = `${current.key}:${current.order}`;

  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-dim text-[10px] leading-none">{label}</span>
      <select
        value={value}
        disabled={pending}
        onChange={(event) => {
          const [key, order] = event.target.value.split(':') as [SortKey, SortOrder];
          apply(key, order);
        }}
        className="border-line bg-raised text-text min-h-9 w-full rounded-[10px] border px-2.5 py-1.5 text-xs disabled:opacity-60"
      >
        {options.map(([key, order, text]) => (
          <option key={`${key}:${order}`} value={`${key}:${order}`}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}
