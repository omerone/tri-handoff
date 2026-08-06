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
  current: { class: string; dir: string; style: string; strategy: string; tag: string };
  options: {
    all: string;
    allStrategies: string;
    /** What each dropdown filters by. See `Filter` below for why these are not optional. */
    names: { class: string; direction: string; style: string; strategy: string; tag: string };
    classes: readonly Option[];
    directions: readonly Option[];
    styles: readonly Option[];
    strategies: readonly Option[];
    tags: readonly Option[];
    allTags: string;
  };
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

  /**
   * One dropdown, with its name attached.
   *
   * The name is visible rather than only an `aria-label`, because three dropdowns all
   * reading "All" side by side do not say which is which — on a phone, where they wrap onto
   * their own row, that is the entire filter bar. The previous `aria-label` was the first
   * *option's* text, so a screen reader announced the asset-class filter as "Forex".
   */
  const Filter = ({
    name,
    value,
    param,
    empty,
    items,
  }: {
    name: string;
    value: string;
    param: string;
    empty: string;
    items: readonly Option[];
  }) => (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-dim text-[10px] leading-none">{name}</span>
      <select
        value={value}
        disabled={pending}
        onChange={(event) => update(param, event.target.value)}
        className="border-line bg-raised text-text min-h-9 w-full rounded-[10px] border px-2.5 py-1.5 text-xs disabled:opacity-60"
      >
        <option value="all">{empty}</option>
        {items.map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <>
      <Filter
        name={options.names.class}
        value={current.class}
        param="class"
        empty={options.all}
        items={options.classes}
      />
      <Filter
        name={options.names.direction}
        value={current.dir}
        param="dir"
        empty={options.all}
        items={options.directions}
      />
      <Filter
        name={options.names.style}
        value={current.style}
        param="style"
        empty={options.all}
        items={options.styles}
      />

      {/* Only shown once the trader has actually labelled something — an empty dropdown is
          noise, and until then there is nothing to filter by. */}
      {options.strategies.length > 0 ? (
        <Filter
          name={options.names.strategy}
          value={current.strategy}
          param="strategy"
          empty={options.allStrategies}
          items={options.strategies}
        />
      ) : null}

      {/* Same rule as strategies, and the same reason. The predicate has been in the query
          since the tags column existed — `tags: { has: ... }` — with nothing in the UI able
          to set it. */}
      {options.tags.length > 0 ? (
        <Filter
          name={options.names.tag}
          value={current.tag}
          param="tag"
          empty={options.allTags}
          items={options.tags}
        />
      ) : null}
    </>
  );
}
