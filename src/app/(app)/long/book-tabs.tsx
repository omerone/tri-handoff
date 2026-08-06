import Link from 'next/link';

export type BookTab = 'long' | 'day' | 'swing';

export const BOOK_TABS: readonly BookTab[] = ['long', 'day', 'swing'];

export function isBookTab(value: unknown): value is BookTab {
  return typeof value === 'string' && (BOOK_TABS as readonly string[]).includes(value);
}

/**
 * Long / Day / Swing, as links rather than as client state.
 *
 * The tab lives in the URL for the same reason the trades table's filters do: a screen
 * someone is looking at can be bookmarked and sent, and the back button behaves. It also
 * keeps this page a server component — each tab loads only its own rows instead of the page
 * shipping all three books to the browser and hiding two of them.
 */
export function BookTabs({
  current,
  labels,
  counts,
}: {
  current: BookTab;
  labels: Record<BookTab, string>;
  /** Shown beside each label so an empty tab is visibly empty before it is opened. */
  counts: Record<BookTab, number>;
}) {
  return (
    <nav className="border-line bg-surface inline-flex rounded-[12px] border p-1">
      {BOOK_TABS.map((tab) => {
        const active = tab === current;
        return (
          <Link
            key={tab}
            href={tab === 'long' ? '/long' : `/long?book=${tab}`}
            aria-current={active ? 'page' : undefined}
            className={`rounded-[9px] px-3 py-1.5 text-xs font-bold transition-colors ${
              active ? 'bg-brand text-white' : 'text-dim hover:text-text'
            }`}
          >
            {labels[tab]}
            {counts[tab] > 0 ? (
              <span className={`ms-1.5 text-[10px] ${active ? 'text-white/70' : 'text-dim/70'}`}>
                {counts[tab]}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
