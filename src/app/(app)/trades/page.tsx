import { getLocale, getTranslations } from 'next-intl/server';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import Link from 'next/link';
import { NotebookPen } from 'lucide-react';
import { Chip, EmptyState, Num } from '@/components/ui/kpi';
import { requireSession } from '@/lib/auth/session';
import { computeMetrics, toAnalyticsTrades } from '@/lib/analytics';
import { listClosedLongPositions, listClosedTrades, type TradeFilter } from '@/lib/db';
import { ASSET_CLASSES, DIRECTIONS, STYLES } from '@/lib/analytics/dimensions';
import { getMt5Account, listJournalVocabulary, listMt5Accounts } from '@/lib/db';
import { LOCALE_DIR, type Locale } from '@/i18n/config';
import { formatNumber } from '@/lib/money/currency';
import { formatDateAt, formatTimeAt } from '@/lib/time/format';
import { currentResolvedRange } from '@/lib/preferences/range';
import { toTradeFilter } from '@/lib/time/range';
import { displayMoney } from '@/lib/money/display';
import { FilterSheet } from '@/components/ui/filter-sheet';
import { TradeFilters } from './filters';
import {
  DEFAULT_SORT,
  isSortKey,
  summarize,
  toRows,
  type RowStyle,
  type Sort,
  type TableRow,
} from './rows';
import { SortHeader, SortSelect } from './sort-control';
import { ReviewControl, type ReviewLabels } from './review-control';
import { TradeSearch } from './search-field';
import { Pager } from './pager';
import {
  RowCheckboxCell,
  RowCheckboxSlot,
  SelectAllHeaderCell,
  SelectionToggle,
  TradeSelection,
} from './selection';

const PAGE_SIZE = 40;

/**
 * What the style dropdown offers. `STYLES` is the database enum and stops at the two deal
 * styles; this table also lists closed long-term holdings, which are a third kind of row.
 */
const ROW_STYLES: readonly RowStyle[] = [...STYLES, 'long'];

type SearchParams = {
  class?: string;
  dir?: string;
  style?: string;
  strategy?: string;
  tag?: string;
  q?: string;
  /** `mt5` or `manual` — who produced the row's figures. See `trades/rows.ts`. */
  source?: string;
  page?: string;
  range?: string;
  /** Which column the table is arranged by, and which way. See `rows.ts`. */
  sort?: string;
  order?: string;
};

/**
 * Longest search accepted, in characters.
 *
 * The predicate is five `contains` scans wide and the box is reachable by anyone signed in,
 * so the one input that decides how much work it is worth is the length of the needle. Two
 * hundred is longer than any note excerpt someone would paste in and short enough that a
 * pathological value cannot be pasted in either.
 */
const MAX_QUERY_LENGTH = 200;

/**
 * The trades table.
 *
 * Filters live in the URL rather than in component state: a trader who has narrowed to
 * "short crypto" can bookmark it or send it to someone, and the back button behaves. It also
 * keeps the page a server component — the filtering happens in the query, so a long book
 * pages rather than shipping every row to the browser.
 */
export default async function TradesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireSession();
  const t = await getTranslations();
  const locale = (await getLocale()) as Locale;
  const rtl = LOCALE_DIR[locale] === 'rtl';
  const params = await searchParams;

  // The range narrows by close date and the dropdowns narrow by everything else; they compose
  // into one `where`, so the table, the pager and the summary bar all see the same population.
  const range = await currentResolvedRange(params.range);
  // `long` is a row style with no column in `trades`, so it never reaches the deal query —
  // `toRows` uses it to drop deals and keep holdings instead.
  /*
   * Every dropdown takes several answers, so every parameter is a list.
   *
   * Comma-separated, and a single value is a list of one — which is what keeps a link written
   * before this existed, or typed by hand, working exactly as it did. Anything unrecognised is
   * dropped rather than refused, for the same reason the sort key falls back: these are URLs
   * people edit and bookmarks that outlive the values they name.
   */
  const many = <T extends string>(
    raw: string | undefined,
    valid: (value: string) => boolean,
  ): T[] => [
    ...new Set(
      (raw ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(valid) as T[],
    ),
  ];

  const classes = many<(typeof ASSET_CLASSES)[number]>(params.class, isAssetClass);
  const directions = many<(typeof DIRECTIONS)[number]>(params.dir, isDirection);
  const rowStyles = many<RowStyle>(params.style, isRowStyle);
  const strategies = many<string>(params.strategy, (value) => value.length > 0);
  const tags = many<string>(params.tag, (value) => value.length > 0);
  const sources = many<'mt5' | 'manual'>(
    params.source,
    (value) => value === 'mt5' || value === 'manual',
  );
  const query = (params.q ?? '').trim().slice(0, MAX_QUERY_LENGTH);

  // `long` is a row style with no column in `trades`, so it never reaches the deal query.
  const dealStyles = rowStyles.filter((style): style is 'day' | 'swing' => style !== 'long');

  const filter: TradeFilter = {
    ...toTradeFilter(range),
    ...(classes.length > 0 ? { assetClass: classes } : {}),
    ...(directions.length > 0 ? { direction: directions } : {}),
    // Asking only for holdings is asking for no deals at all, which the row layer handles by
    // dropping them — the query must not be told to select every style instead.
    ...(dealStyles.length > 0 ? { style: dealStyles } : {}),
    ...(strategies.length > 0 ? { strategy: strategies } : {}),
    ...(tags.length > 0 ? { tag: tags } : {}),
    ...(query ? { query } : {}),
    ...(sources.length > 0 ? { mt5AccountId: sources } : {}),
  };

  /*
   * The ordering, read the same way the filters are.
   *
   * An unrecognised key falls back rather than throwing: this is a URL a person can edit and a
   * link that can outlive a column, and a table that refuses to render because a stale
   * bookmark names a sort it no longer has is worse than one that opens on its default.
   */
  const sort: Sort = isSortKey(params.sort)
    ? { key: params.sort, order: params.order === 'asc' ? 'asc' : 'desc' }
    : DEFAULT_SORT;

  const page = Math.max(1, Number(params.page) || 1);

  const [filteredRecords, closedPositions, account, vocabulary] = await Promise.all([
    // The summary bar reflects the *filter*, not the page — the whole point of narrowing to
    // "short crypto" is seeing what short crypto did overall.
    listClosedTrades(session.ctx, filter),
    listClosedLongPositions(session.ctx, { from: filter.from, to: filter.to }),
    getMt5Account(session.ctx),
    listJournalVocabulary(session.ctx),
  ]);

  /*
   * Whether a broker could put a deleted row back.
   *
   * `listMt5Accounts` is request-cached and `getMt5Account` above already went through it, so
   * this is the same call and costs nothing. It decides one sentence in the delete
   * confirmation: a connected account re-reads a two-day overlap on the next refresh and
   * writes back what was just removed, while a disconnected one has had its credentials
   * cleared and cannot. Saying so only when it is true is the difference between a warning
   * and noise.
   */
  const brokerConnected = (await listMt5Accounts(session.ctx)).some(
    (account) => account.status === 'connected',
  );

  // Deals only. A holding has no stop loss, so it has no R to average and no win to rate;
  // feeding it in here would divide by a denominator it never contributed to.
  const metrics = computeMetrics(toAnalyticsTrades(filteredRecords));

  /*
   * Paged in memory rather than in SQL, now that a page is drawn from two tables.
   *
   * `listClosedTrades` above already loads the whole filtered set for the summary, so this
   * costs no extra round trip and no extra rows — it just stops the page and the summary
   * disagreeing about what the filter selected, which is the property the comment on the
   * filter above is describing. Both queries cap at 5000.
   */
  const allRows = await toRows(filteredRecords, closedPositions, {
    accountCurrency: account?.accountCurrency ?? 'USD',
    sort,
    filter: {
      assetClass: classes,
      direction: directions,
      style: rowStyles,
      strategy: strategies,
      tag: tags,
      source: sources,
      ...(query ? { query } : {}),
    },
  });
  const summary = summarize(allRows);
  const total = allRows.length;
  const rows = allRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const { money } = await displayMoney({
    source: account?.accountCurrency ?? 'USD',
    display: session.user.displayCurrency,
    locale,
  });

  const closedAt = (at: Date) => `${formatDateAt(at)} · ${formatTimeAt(at)}`;

  /*
   * A holding whose currency has no rate today keeps its own — shown with the code beside it
   * so "1,000" is never read as account currency it is not. Everything else goes through
   * `money`, which converts from the account currency to the user's display one.
   */
  const rowMoney = (row: TableRow) =>
    row.profit === null && row.profitInOwnCurrency
      ? `${formatNumber(row.profitInOwnCurrency.amount, locale, 2)} ${row.profitInOwnCurrency.currency}`
      : money(row.profit ?? 0, { signed: true });

  const rowSign = (row: TableRow) => (row.profit ?? row.profitInOwnCurrency?.amount ?? 0) >= 0;

  /*
   * What a tick box announces itself as. Forty checkboxes all reading "select row" is a
   * screen-reader user being asked to pick from forty identical controls, so this names the
   * one thing that tells the rows apart at a glance — the instrument and when it closed.
   */
  const rowLabel = (row: TableRow) =>
    row.closeAt ? `${row.symbol} · ${closedAt(row.closeAt)}` : row.symbol;

  const reviewLabels: ReviewLabels = {
    tpTiming: t('review.tpTiming'),
    originalTp: t('review.originalTp'),
    unset: t('review.unset'),
    timings: {
      early: t('review.timings.early'),
      onTime: t('review.timings.onTime'),
      late: t('review.timings.late'),
    },
    answers: { yes: t('review.answers.yes'), no: t('review.answers.no') },
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  /*
   * How many filters are narrowing the table, for the badge on the phone's filter button.
   *
   * Counted as *filters*, not as values: "crypto and indices" is one decision the trader made
   * and one thing to undo. The search box is not in it — it is visible in the row at every
   * size, so it is never the hidden thing the badge exists to disclose.
   */
  const activeFilters = [
    params.class,
    params.dir,
    params.style,
    params.strategy,
    params.tag,
    params.source,
  ].filter((value) => (value ?? '').trim() !== '' && value !== 'all').length;

  const align = rtl ? 'text-right' : 'text-left';

  return (
    <div className="flex flex-col gap-4">
      <Card title={t('table.filter')}>
        <div className="grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap">
          <TradeSearch
            label={t('table.search')}
            placeholder={t('table.searchHint')}
            clear={t('table.searchClear')}
          />
          {/*
            Everything but the search folds behind one button on a phone.

            The count on that button is the point of it: a filter you cannot see is a filter
            you forget is on, and "no trades match" then reads as an empty book. Search stays
            in the row because it is the control people reach for most and it costs one line.
          */}
          <FilterSheet
            title={t('table.filter')}
            active={activeFilters}
            labels={{
              open: t('table.filter'),
              close: t('table.filterClose'),
              done: t('table.filterDone'),
            }}
          >
            <TradeFilters
              current={{
                class: params.class ?? '',
                dir: params.dir ?? '',
                style: params.style ?? '',
                strategy: params.strategy ?? '',
                tag: params.tag ?? '',
                source: params.source ?? '',
              }}
              options={{
                all: t('table.all'),
                allStrategies: t('table.allStrategies'),
                names: {
                  class: t('table.assetClass'),
                  direction: t('table.direction'),
                  style: t('table.style'),
                  strategy: t('table.strategy'),
                  tag: t('journal.tags'),
                  source: t('trades.source.label'),
                },
                classes: ASSET_CLASSES.map((key) => [key, t(`enum.assetClass.${key}`)] as const),
                directions: DIRECTIONS.map((key) => [key, t(`enum.direction.${key}`)] as const),
                styles: ROW_STYLES.map((key) => [key, t(`enum.style.${key}`)] as const),
                sources: [
                  ['mt5', t('trades.source.mt5')],
                  ['manual', t('trades.source.manual')],
                ] as const,
                strategies: vocabulary.strategies.map((value) => [value, value] as const),
                tags: vocabulary.tags.map((value) => [value, value] as const),
                allTags: t('table.all'),
              }}
            />
          </FilterSheet>

          {/*
            The ordering, in the filter bar rather than only on the headings.

            `md:hidden` because from the tablet breakpoint up the headings are the control and
            two ways to set the same thing side by side is one too many. Below it there is no
            table at all — the rows are cards — so without this there is no way to ask for the
            biggest loss on a phone, which is the screen most of this gets read on.
          */}
          <div className="md:hidden">
            <SortSelect
              current={sort}
              label={t('table.sort')}
              options={[
                ['closeAt', 'desc', t('table.sortNewest')],
                ['closeAt', 'asc', t('table.sortOldest')],
                ['profit', 'desc', t('table.sortPnlHigh')],
                ['profit', 'asc', t('table.sortPnlLow')],
                ['rr', 'desc', t('table.sortRrHigh')],
                ['rr', 'asc', t('table.sortRrLow')],
                ['risk', 'desc', t('table.sortRiskHigh')],
                ['risk', 'asc', t('table.sortRiskLow')],
                ['symbol', 'asc', t('table.sortSymbol')],
              ]}
            />
          </div>

          <div className="text-dim col-span-2 flex gap-4 text-xs sm:col-span-1 sm:ms-auto">
            <span>{t('kpi.tradesCount', { count: summary.trades })}</span>
            {summary.positions > 0 ? (
              <span>{t('table.holdingsCount', { count: summary.positions })}</span>
            ) : null}
            <span className={summary.net >= 0 ? 'text-pos' : 'text-neg'}>
              <Num>{money(summary.net, { signed: true })}</Num>
            </span>
            <Num>{metrics.avgRr === null ? '—' : `${formatNumber(metrics.avgRr, locale, 2)}R`}</Num>
          </div>
        </div>
      </Card>

      <Card pad={false}>
        {rows.length === 0 ? (
          /*
            A search that matched nothing is a different statement from a window with no
            trades in it, and the fix is different too — clear the box, rather than widen the
            date range. The message names the term so it is obvious *what* found nothing.
          */
          <EmptyState>{query ? t('table.emptySearch', { query }) : t('table.empty')}</EmptyState>
        ) : (
          <TradeSelection
            rows={rows.map((trade) => ({ key: trade.key, source: trade.source }))}
            brokerConnected={brokerConnected}
          >
            {/*
              The one control that is always drawn, and the only one until it is pressed.

              `justify-start`, which is the *reading* start — the right in Hebrew and the left
              in English. The tick column is the table's first column and sits on that same
              side, so the boxes appear directly under the button that asked for them. Written
              as `justify-end` first, which reads as "the far side" and puts the button across
              the table from the column it reveals in exactly one of the two locales.
            */}
            <div className="border-line flex justify-start border-b px-4 py-2">
              <SelectionToggle />
            </div>

            {/*
             * On a phone the table is 660 pixels wide inside a 340 pixel scroller, which puts
             * P&L and RR — the two numbers this screen exists for — off the right edge behind
             * a sideways scroll nobody discovers. Below the tablet breakpoint the same rows
             * are a list instead, with the figures where the eye already is, and the whole
             * row tappable rather than a 14-pixel notebook icon.
             */}
            <ul className="md:hidden">
              {rows.map((trade) => (
                <li
                  key={trade.key}
                  className="border-line flex items-start border-b last:border-b-0"
                >
                  <RowCheckboxSlot rowKey={trade.key} label={rowLabel(trade)} />

                  <div className="flex min-w-0 flex-1 flex-col">
                    <Link
                      href={trade.href}
                      className="hover:bg-raised/60 flex flex-col gap-1 px-3 py-3"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2">
                          {/*
                          `dir="ltr"` so a symbol too long for the row loses its tail rather
                          than its head. Inside the Hebrew layout the ellipsis lands at the
                          logical end, which is the *left* — "XAUUSD.MICRO.LONGNAME" rendered
                          as "…CRO.LONGNAME", hiding the one part that identifies the
                          instrument. A ticker is a left-to-right run, like every number here.
                        */}
                          <span dir="ltr" className="truncate text-[15px] font-bold">
                            {trade.symbol}
                          </span>
                          <Chip>{t(`enum.assetClass.${trade.assetClass}`)}</Chip>
                        </span>
                        <span
                          className={`shrink-0 text-[15px] font-bold ${
                            rowSign(trade) ? 'text-pos' : 'text-neg'
                          }`}
                        >
                          <Num>{rowMoney(trade)}</Num>
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`inline-flex items-center gap-1 text-xs ${
                            trade.direction === 'long' ? 'text-pos' : 'text-neg'
                          }`}
                        >
                          {trade.direction === 'long' ? (
                            <ArrowUpRight size={13} aria-hidden />
                          ) : (
                            <ArrowDownRight size={13} aria-hidden />
                          )}
                          {t(`enum.direction.${trade.direction}`)}
                          <span className="text-dim">· {t(`enum.style.${trade.style}`)}</span>
                        </span>
                        {trade.rr === null ? (
                          <Chip tone="dim">—</Chip>
                        ) : (
                          <Chip tone={trade.rr >= 0 ? 'pos' : 'neg'}>
                            <Num>
                              {trade.rr >= 0 ? '+' : ''}
                              {formatNumber(trade.rr, locale, 2)}R
                            </Num>
                          </Chip>
                        )}
                      </div>

                      <div className="text-dim flex items-center justify-between gap-2 text-[11px]">
                        <Num>{trade.closeAt ? closedAt(trade.closeAt) : '—'}</Num>
                        <span className="flex items-center gap-2">
                          <span>
                            {t('table.risk')}{' '}
                            <Num>{trade.risk === null ? '—' : money(trade.risk)}</Num>
                          </span>
                          {trade.journalled ? (
                            <NotebookPen
                              size={13}
                              className="text-brand"
                              aria-label={t('journal.title')}
                            />
                          ) : null}
                          {trade.rating === null ? null : (
                            <span className="text-dim text-[10px] leading-none" dir="ltr">
                              {'★'.repeat(trade.rating)}
                            </span>
                          )}
                          {trade.mood ? (
                            <span className="text-dim text-[10px]">{trade.mood}</span>
                          ) : null}
                        </span>
                      </div>
                    </Link>

                    {/*
                      Outside the Link on purpose. A select nested inside an anchor is opened
                      by a tap that the anchor also handles, so answering a question would
                      navigate away from the row being answered.
                    */}
                    {trade.isPosition ? null : (
                      <div className="px-3 pb-3">
                        <ReviewControl
                          tradeId={trade.key.replace('trade:', '')}
                          tpTiming={trade.tpTiming}
                          tookOriginalTp={trade.tookOriginalTp}
                          labels={reviewLabels}
                        />
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="text-dim text-[11px]">
                    {/* Its own cell rather than sharing the date's, so the column stays put
                        when a date wraps and the header box lines up over the row boxes. */}
                    <SelectAllHeaderCell />
                    {/*
                      A heading is either a sort control or a word, and which it is depends on
                      whether the column holds something with an order. Asset class, direction
                      and style are the ones you narrow by, not the ones you arrange by — the
                      dropdowns above answer those better than a table split into two blocks.
                    */}
                    {(
                      [
                        [t('table.closed'), 'closeAt'],
                        [t('table.symbol'), 'symbol'],
                        ['', null],
                        [t('table.direction'), null],
                        [t('table.style'), null],
                        [t('table.risk'), 'risk'],
                        [t('table.rr'), 'rr'],
                        [t('table.pnl'), 'profit'],
                        [t('review.tpTiming'), null],
                        ['', null],
                      ] as const
                    ).map(([header, sortKey], index) => (
                      <th
                        key={index}
                        /* On the cell, which is where the role that supports it lives — a
                           button has no sort state, the column does. */
                        aria-sort={
                          sortKey && sort.key === sortKey
                            ? sort.order === 'asc'
                              ? 'ascending'
                              : 'descending'
                            : undefined
                        }
                        className={`border-line border-b px-3.5 py-2.5 font-semibold ${align}`}
                      >
                        {sortKey ? (
                          <SortHeader label={header} sortKey={sortKey} current={sort} />
                        ) : (
                          header
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((trade) => (
                    <tr key={trade.key} className="border-line border-b last:border-b-0">
                      <RowCheckboxCell rowKey={trade.key} label={rowLabel(trade)} />
                      <td className="text-dim px-3.5 py-2.5 text-xs whitespace-nowrap">
                        <Num>{trade.closeAt ? closedAt(trade.closeAt) : '—'}</Num>
                      </td>
                      <td className="px-3.5 py-2.5 font-bold">{trade.symbol}</td>
                      <td className="px-3.5 py-2.5">
                        <Chip>{t(`enum.assetClass.${trade.assetClass}`)}</Chip>
                      </td>
                      <td className="px-3.5 py-2.5">
                        <span
                          className={`inline-flex items-center gap-1 text-xs ${
                            trade.direction === 'long' ? 'text-pos' : 'text-neg'
                          }`}
                        >
                          {trade.direction === 'long' ? (
                            <ArrowUpRight size={13} aria-hidden />
                          ) : (
                            <ArrowDownRight size={13} aria-hidden />
                          )}
                          {t(`enum.direction.${trade.direction}`)}
                        </span>
                      </td>
                      <td className="text-dim px-3.5 py-2.5 text-xs">
                        <span className="flex items-center gap-1.5">
                          {t(`enum.style.${trade.style}`)}
                          {/*
                          Where the figure came from. The journal deliberately mixes the
                          broker's rows with the trader's own, and every calculation is meant
                          not to care — but the first question asked of a number that looks
                          wrong is "is this mine or the broker's?", and until this chip the
                          only way to answer it was to know that manual tickets start with
                          `manual:`.

                          MT5 carries the theme's second accent, which nothing else on this
                          screen uses. It was grey, on the reasoning that the common case
                          should be quiet — but grey is what every muted thing in the table
                          looks like, so the badge read as decoration rather than as an answer.
                          Hand-entered rows stay grey: between the two, the one worth spotting
                          at a glance is the one the broker vouched for.

                          `data-source` so the answer can be read as an answer. Table cells
                          concatenate with nothing between them — a row's text runs
                          "…DayMT5₪418" — so a test looking for the word finds it welded to the
                          one before it, and a test written to cope with that is asserting on
                          string surgery rather than on what the row says.
                        */}
                          <span data-source={trade.source}>
                            <Chip tone={trade.source === 'mt5' ? 'broker' : 'dim'}>
                              {t(`trades.source.${trade.source}`)}
                            </Chip>
                          </span>
                        </span>
                      </td>
                      <td className="px-3.5 py-2.5 text-xs">
                        <Num>{trade.risk === null ? '—' : money(trade.risk)}</Num>
                      </td>
                      <td className="px-3.5 py-2.5">
                        {trade.rr === null ? (
                          // No stop loss: shown as absent rather than as 0R, which would read
                          // as a break-even trade.
                          <Chip tone="dim">—</Chip>
                        ) : (
                          <Chip tone={trade.rr >= 0 ? 'pos' : 'neg'}>
                            <Num>
                              {trade.rr >= 0 ? '+' : ''}
                              {formatNumber(trade.rr, locale, 2)}R
                            </Num>
                          </Chip>
                        )}
                      </td>
                      <td
                        className={`px-3.5 py-2.5 font-bold ${
                          rowSign(trade) ? 'text-pos' : 'text-neg'
                        }`}
                      >
                        <Num>{rowMoney(trade)}</Num>
                      </td>
                      <td className="px-3.5 py-2.5">
                        {/*
                        Blank for a holding: it has no take-profit, so neither question has an
                        answer that would mean anything.
                      */}
                        {trade.isPosition ? null : (
                          <ReviewControl
                            tradeId={trade.key.replace('trade:', '')}
                            tpTiming={trade.tpTiming}
                            tookOriginalTp={trade.tookOriginalTp}
                            labels={reviewLabels}
                          />
                        )}
                      </td>
                      <td className="px-3.5 py-2.5 text-end">
                        {/*
                        A filled icon means there is already something written here, so a
                        trader working through a week can see at a glance which trades they
                        have been through.
                      */}
                        <span className="inline-flex items-center gap-1.5">
                          {/* The score reads without opening anything; four thousand characters
                            of note do not, so the tooltip carries their first line. */}
                          {trade.rating === null ? null : (
                            <span className="text-dim text-[10px] leading-none" dir="ltr">
                              {'★'.repeat(trade.rating)}
                              <span className="text-dim/30">{'★'.repeat(5 - trade.rating)}</span>
                            </span>
                          )}
                          <Link
                            href={trade.href}
                            aria-label={t('journal.title')}
                            data-tip={trade.noteExcerpt ?? trade.strategy ?? t('journal.title')}
                            className={`inline-flex ${trade.journalled ? 'text-brand' : 'text-dim/50 hover:text-text'}`}
                          >
                            <NotebookPen size={14} aria-hidden />
                          </Link>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TradeSelection>
        )}
      </Card>

      {pages > 1 ? (
        <Pager
          page={page}
          pages={pages}
          labels={{
            prev: t('table.prev'),
            next: t('table.next'),
            page: t('table.page', {
              page: formatNumber(page, locale),
              total: formatNumber(pages, locale),
            }),
          }}
        />
      ) : null}
    </div>
  );
}

function isAssetClass(value: unknown): value is (typeof ASSET_CLASSES)[number] {
  return typeof value === 'string' && (ASSET_CLASSES as readonly string[]).includes(value);
}
function isDirection(value: unknown): value is (typeof DIRECTIONS)[number] {
  return typeof value === 'string' && (DIRECTIONS as readonly string[]).includes(value);
}
function isRowStyle(value: unknown): value is RowStyle {
  return typeof value === 'string' && (ROW_STYLES as readonly string[]).includes(value);
}
