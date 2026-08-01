'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

type Option = readonly [string, string];

/**
 * Filters that write to the URL.
 *
 * Changing one resets the page number — landing on page 7 of a filter that has two pages
 * would show an empty table and look like "no trades match", which is a different statement.
 */
export function TradeFilters({
  current,
  options,
}: {
  current: { class: string; dir: string; style: string };
  options: { all: string; classes: readonly Option[]; directions: readonly Option[]; styles: readonly Option[] };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const update = (name: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value === 'all') next.delete(name);
    else next.set(name, value);
    next.delete('page');

    const query = next.toString();
    startTransition(() => router.push(query ? `${pathname}?${query}` : pathname));
  };

  const select =
    'border-line bg-raised text-text rounded-[10px] border px-2.5 py-1.5 text-xs disabled:opacity-60';

  return (
    <>
      <select
        aria-label={options.classes[0]?.[1]}
        value={current.class}
        disabled={pending}
        onChange={(event) => update('class', event.target.value)}
        className={select}
      >
        <option value="all">{options.all}</option>
        {options.classes.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      <select
        aria-label={options.directions[0]?.[1]}
        value={current.dir}
        disabled={pending}
        onChange={(event) => update('dir', event.target.value)}
        className={select}
      >
        <option value="all">{options.all}</option>
        {options.directions.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      <select
        aria-label={options.styles[0]?.[1]}
        value={current.style}
        disabled={pending}
        onChange={(event) => update('style', event.target.value)}
        className={select}
      >
        <option value="all">{options.all}</option>
        {options.styles.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </>
  );
}
