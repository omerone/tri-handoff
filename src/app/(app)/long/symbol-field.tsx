'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Loader2, Search } from 'lucide-react';

/**
 * The symbol box: type a company name or a ticker, pick a listing.
 *
 * Picking one is what makes a position *tracked* — it fills in the MIC and the currency, and
 * those two are what let the refresh find a price for it later. Typing a symbol freehand still
 * works and still creates a position; it simply stays on manual pricing, which is what every
 * position did before this existed.
 *
 * Written as a combobox rather than a `<select>` because the catalogue is the world's
 * exchanges: the list only exists once there is something to search for.
 */

export type SymbolMatchView = {
  symbol: string;
  name: string;
  exchange: string;
  micCode: string;
  currency: string;
};

export type SymbolFieldLabels = {
  symbol: string;
  /** "Search by company name or symbol" — the placeholder that says both halves work. */
  searchHint: string;
  searching: string;
  noMatches: string;
};

/** Long enough that a fast typist does not fire a request per keystroke. */
const DEBOUNCE_MS = 250;

export function SymbolField({
  labels,
  className = '',
  onPick,
}: {
  labels: SymbolFieldLabels;
  className?: string;
  /** Lets the form move the currency select to the listing's own currency. */
  onPick: (match: SymbolMatchView | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SymbolMatchView[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<SymbolMatchView | null>(null);

  const listId = useId();
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // A picked listing is a finished search; re-running it would reopen the menu under the
    // user the moment they move on to the quantity field.
    if (picked && picked.symbol === query) return;

    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }

    // Aborted on the next keystroke, so the answer on screen is always the answer to what is
    // in the box — out-of-order responses are how a search box ends up showing someone else's
    // results.
    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/symbols?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
        const body = (await response.json()) as { results?: SymbolMatchView[] };
        setResults(body.results ?? []);
        setActive(0);
        setOpen(true);
      } catch {
        // An aborted or failed lookup leaves the box exactly as it is: the user can still
        // type a symbol by hand, which is the whole fallback.
      } finally {
        setSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, picked]);

  // Clicking anywhere else is "never mind" — without this the menu survives until the field
  // is focused again, floating over the rest of the form.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const choose = (match: SymbolMatchView) => {
    setPicked(match);
    setQuery(match.symbol);
    setOpen(false);
    onPick(match);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || results.length === 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActive((index) => (index + delta + results.length) % results.length);
    } else if (event.key === 'Enter') {
      // Only while the menu is open: otherwise this is the Enter that submits the form.
      event.preventDefault();
      const match = results[active];
      if (match) choose(match);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <label className="flex flex-col gap-1">
        <span className="text-dim text-[11px] font-semibold">{labels.symbol}</span>
        <span className="relative flex items-center">
          <input
            name="symbol"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              // Editing after a pick unpicks: the MIC that came with it belongs to a listing
              // the text no longer names, and keeping it would track the wrong instrument.
              if (picked) {
                setPicked(null);
                onPick(null);
              }
            }}
            onKeyDown={onKeyDown}
            onFocus={() => results.length > 0 && setOpen(true)}
            required
            maxLength={24}
            dir="ltr"
            autoComplete="off"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            placeholder={labels.searchHint}
            // Physical `pr`, not logical `pe` — the same trap `DateField` documents, and the
            // same fix. This input is `dir="ltr"` so a ticker reads correctly, which puts its
            // logical end on the *right*; the icon beside it sat at the wrapper's logical end,
            // which inside the Hebrew layout is the *left*. Space reserved on one side and the
            // icon drawn on the other is what put the magnifier on top of the "T" in "TSLA".
            // Both are physical now, so they cannot disagree.
            className="border-line bg-raised text-text placeholder:text-dim/60 w-52 rounded-[10px] border px-3 py-2 pr-7 text-sm"
          />
          <span className="text-dim pointer-events-none absolute right-2">
            {searching ? (
              <Loader2 size={13} className="tri-spin" aria-label={labels.searching} />
            ) : (
              <Search size={13} aria-hidden />
            )}
          </span>
        </span>
      </label>

      {/* The two fields that make a position priceable. Hidden, because their values are not
          the user's to type — they come from the listing they picked. */}
      <input type="hidden" name="micCode" value={picked?.micCode ?? ''} />
      <input type="hidden" name="priceSource" value={picked ? 'auto' : 'manual'} />

      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="border-line bg-raised absolute z-30 mt-1 max-h-96 w-72 overflow-auto rounded-[10px] border py-1 shadow-lg"
        >
          {results.length === 0 ? (
            <li className="text-dim px-3 py-2 text-xs">
              {searching ? labels.searching : labels.noMatches}
            </li>
          ) : (
            results.map((match, index) => (
              <li key={`${match.symbol}@${match.micCode}`} role="option" aria-selected={index === active}>
                <button
                  type="button"
                  // `onMouseDown` rather than `onClick`: the click would land after the input
                  // has already lost focus and closed the menu out from under it.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(match);
                  }}
                  onMouseEnter={() => setActive(index)}
                  className={`flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-start ${
                    index === active ? 'bg-brand/10' : ''
                  }`}
                >
                  <span className="min-w-0">
                    <span className="text-text text-xs font-bold" dir="ltr">
                      {match.symbol}
                    </span>
                    <span className="text-dim ms-2 truncate text-[11px]">{match.name}</span>
                  </span>
                  <span className="text-dim shrink-0 text-[10px]" dir="ltr">
                    {match.exchange} · {match.currency}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
