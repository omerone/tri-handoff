'use client';

import { Search, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

/**
 * How long the box waits after the last keystroke before it navigates.
 *
 * Every change here is a server round trip that re-runs the query, so typing "breakout"
 * un-debounced is eight of them and the first seven are answers to prefixes nobody asked
 * about. A third of a second is long enough to swallow a word being typed and short enough
 * that it does not feel like waiting.
 */
const DEBOUNCE_MS = 350;

/**
 * The free-text box over the trades table.
 *
 * Its value lives in the URL like every other filter on this screen, for the reasons the page
 * gives: a narrowed table can be bookmarked and sent, and the back button behaves. That is
 * also why the input keeps its own state rather than reading `searchParams` on every render —
 * the URL trails the keystrokes by `DEBOUNCE_MS`, and an input bound straight to it would drop
 * whatever was typed during the gap.
 */
export function TradeSearch({ label, placeholder, clear }: {
  label: string;
  placeholder: string;
  clear: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const urlQuery = params.get('q') ?? '';
  const [value, setValue] = useState(urlQuery);

  /*
   * Follow the URL when it changes from outside — the back button, or a link to a saved
   * search. Guarded on the URL differing from what this box last pushed, so it does not
   * fight the debounce and rewrite the field mid-word.
   */
  const pushed = useRef(urlQuery);
  useEffect(() => {
    if (urlQuery !== pushed.current) {
      pushed.current = urlQuery;
      setValue(urlQuery);
    }
  }, [urlQuery]);

  useEffect(() => {
    if (value === urlQuery) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      const trimmed = value.trim();
      if (trimmed) next.set('q', trimmed);
      else next.delete('q');
      // Same rule as the dropdowns: a narrower population makes the current page number a
      // claim about a page that may not exist.
      next.delete('page');

      pushed.current = trimmed;
      const query = next.toString();
      startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname));
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // `params` is a new object on every render; the string is what actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, urlQuery, pathname, params.toString(), router]);

  return (
    <label className="col-span-2 flex min-w-0 flex-col gap-1 sm:col-span-1">
      <span className="text-dim text-[10px] leading-none">{label}</span>
      <span className="relative flex items-center">
        <Search
          size={13}
          aria-hidden
          className="text-dim pointer-events-none absolute start-2.5"
        />
        <input
          type="search"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder}
          aria-label={label}
          /*
            The `::-webkit-search-cancel-button` rule is load-bearing. `type="search"` earns
            the semantics and the on-screen keyboard, and it also makes Chrome and Safari draw
            their own clear button — which sat next to ours, so the field showed two × icons.
            Firefox draws none, which is why ours has to exist at all.
          */
          className="border-line bg-raised text-text placeholder:text-dim/60 min-h-9 w-full rounded-[10px] border px-2.5 py-1.5 text-xs ps-7 pe-7 [&::-webkit-search-cancel-button]:appearance-none"
        />
        {/* Ours, so the control exists on every browser rather than on two of them. */}
        {value ? (
          <button
            type="button"
            onClick={() => setValue('')}
            aria-label={clear}
            className="text-dim hover:text-text absolute end-2 inline-flex"
          >
            <X size={13} aria-hidden />
          </button>
        ) : null}
      </span>
    </label>
  );
}
