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
    /*
     * Centred, and the same shape at both sizes.
     *
     * `mx-auto` on a `w-fit` bar rather than a centring wrapper, so the row is exactly as wide
     * as the three tabs and sits in the middle of whatever column it is dropped into. Full
     * width on a phone, where three tabs of different lengths left a ragged bar hugging one
     * edge; `w-fit` again from `sm`, where the content is narrower than the page and a
     * stretched bar would look like a mistake.
     */
    <nav className="border-line bg-surface mx-auto flex w-full items-stretch gap-1 rounded-[12px] border p-1 sm:w-fit">
      {BOOK_TABS.map((tab) => {
        const active = tab === current;
        return (
          /*
           * `flex`, and this is the whole reason the count used to sit on the wrong side.
           *
           * These were inline children, and inline children are laid out by the bidi
           * algorithm, not by the writing direction of the box. European digits next to a
           * Latin word are absorbed into that word's left-to-right run, so "Swing" and its
           * count rendered as one unit with the number on the *right* — while the Hebrew tab
           * beside it put its own count on the *left*. Two tabs, one markup, opposite sides.
           *
           * Flex items are not reordered by bidi. They follow the container's direction, so
           * every count now sits at the same logical end of every label whatever script the
           * label is written in.
           */
          <Link
            key={tab}
            href={tab === 'long' ? '/long' : `/long?book=${tab}`}
            aria-current={active ? 'page' : undefined}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-[9px] px-3 py-1.5 text-center text-xs font-bold transition-colors sm:flex-none ${
              active ? 'bg-brand text-on-brand' : 'text-dim hover:text-text hover:bg-raised'
            }`}
          >
            {/* `min-w-0` so the longest label shrinks inside its tab rather than pushing the
                bar wider than the phone it is on. */}
            <span className="min-w-0 truncate">{labels[tab]}</span>

            {counts[tab] > 0 ? (
              /*
               * `dir="ltr"` and `tabular-nums`: a count is a number, read left to right in
               * every locale this product has, and 26 beside 8 should not shuffle its digits
               * because the paragraph around it runs the other way.
               *
               * `min-w-*` keeps a one-digit badge the same width as a two-digit one, so the
               * tabs do not resize as rows are added and removed.
               */
              <span
                dir="ltr"
                className={`inline-flex min-w-[1.125rem] shrink-0 items-center justify-center rounded-full px-1 text-[10px] leading-[1.4] font-semibold tabular-nums ${
                  active ? 'bg-white/25 text-white' : 'bg-line/70 text-dim'
                }`}
              >
                {counts[tab]}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
