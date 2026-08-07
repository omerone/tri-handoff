'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { MultiFilter } from './multi-filter';

type Option = readonly [string, string];

/**
 * Filters that write to the URL.
 *
 * Each one takes several answers, joined by commas — `class=crypto,indices`. A single value is
 * a list of one, so every link written before this existed still means what it did, including
 * the `all` sentinel the single-select version used for "no filter".
 *
 * Changing one resets the page number — landing on page 7 of a filter that has two pages
 * would show an empty table and look like "no trades match", which is a different statement.
 */
export function TradeFilters({
  current,
  options,
}: {
  /** Comma-separated, straight from the URL — this splits them. */
  current: {
    class: string;
    dir: string;
    style: string;
    strategy: string;
    tag: string;
    source: string;
  };
  options: {
    all: string;
    allStrategies: string;
    /** What each dropdown filters by. See `Filter` below for why these are not optional. */
    names: {
      class: string;
      direction: string;
      style: string;
      strategy: string;
      tag: string;
      source: string;
    };
    classes: readonly Option[];
    directions: readonly Option[];
    styles: readonly Option[];
    sources: readonly Option[];
    strategies: readonly Option[];
    tags: readonly Option[];
    allTags: string;
  };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const update = (name: string, values: readonly string[]) => {
    const next = new URLSearchParams(params.toString());
    if (values.length === 0) next.delete(name);
    else next.set(name, values.join(','));
    next.delete('page');

    const query = next.toString();
    startTransition(() => router.push(query ? `${pathname}?${query}` : pathname));
  };

  /**
   * One dropdown, with its name attached.
   *
   * The name is visible rather than only an `aria-label`, because several dropdowns all
   * reading "All" side by side do not say which is which — on a phone, where they wrap onto
   * their own rows, that is the entire filter bar. An earlier version used the first
   * *option's* text as the label, so a screen reader announced the asset-class filter as
   * "Forex".
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
    <MultiFilter
      name={name}
      /* `all` was the single-select sentinel and may still be sitting in a bookmarked URL.
         It meant "no filter", which is now an empty list. */
      values={value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '' && entry !== 'all')}
      options={items}
      empty={empty}
      disabled={pending}
      onApply={(next) => update(param, next)}
    />
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

      {/* Where the figures came from, which is the question the badge in the table answers one
          row at a time. Narrowing to the broker's rows is how a trader checks their own record
          against the account, and narrowing to their own is how they find what they typed — a
          holding is always the second, so it drops out of the first. */}
      <Filter
        name={options.names.source}
        value={current.source}
        param="source"
        empty={options.all}
        items={options.sources}
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
          since the tags column existed — `tags: { hasSome: … }` — with nothing in the UI able
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
