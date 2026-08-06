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
import { getMt5Account, listJournalVocabulary } from '@/lib/db';
import { LOCALE_DIR, type Locale } from '@/i18n/config';
import { formatNumber } from '@/lib/money/currency';
import { formatDateAt, formatTimeAt } from '@/lib/time/format';
import { currentResolvedRange } from '@/lib/preferences/range';
import { toTradeFilter } from '@/lib/time/range';
import { displayMoney } from '@/lib/money/display';
import { TradeFilters } from './filters';
import { summarize, toRows, type RowStyle, type TableRow } from './rows';
import { ReviewControl, type ReviewLabels } from './review-control';
import { Pager } from './pager';

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
  page?: string;
  range?: string;
};

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
  const rowStyle = isRowStyle(params.style) ? params.style : undefined;
  const filter: TradeFilter = {
    ...toTradeFilter(range),
    ...(isAssetClass(params.class) ? { assetClass: params.class } : {}),
    ...(isDirection(params.dir) ? { direction: params.dir } : {}),
    ...(rowStyle && rowStyle !== 'long' ? { style: rowStyle } : {}),
    ...(params.strategy ? { strategy: params.strategy } : {}),
  };

  const page = Math.max(1, Number(params.page) || 1);

  const [filteredRecords, closedPositions, account, vocabulary] = await Promise.all([
    // The summary bar reflects the *filter*, not the page — the whole point of narrowing to
    // "short crypto" is seeing what short crypto did overall.
    listClosedTrades(session.ctx, filter),
    listClosedLongPositions(session.ctx, { from: filter.from, to: filter.to }),
    getMt5Account(session.ctx),
    listJournalVocabulary(session.ctx),
  ]);

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
    filter: {
      ...(isAssetClass(params.class) ? { assetClass: params.class } : {}),
      ...(isDirection(params.dir) ? { direction: params.dir } : {}),
      ...(rowStyle ? { style: rowStyle } : {}),
      ...(params.strategy ? { strategy: params.strategy } : {}),
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
  const align = rtl ? 'text-right' : 'text-left';

  return (
    <div className="flex flex-col gap-4">
      <Card title={t('table.filter')}>
        <div className="grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap">
          <TradeFilters
            current={{
              class: params.class ?? 'all',
              dir: params.dir ?? 'all',
              style: params.style ?? 'all',
              strategy: params.strategy ?? 'all',
            }}
            options={{
              all: t('table.all'),
              allStrategies: t('table.allStrategies'),
              names: {
                class: t('table.assetClass'),
                direction: t('table.direction'),
                style: t('table.style'),
                strategy: t('table.strategy'),
              },
              classes: ASSET_CLASSES.map((key) => [key, t(`enum.assetClass.${key}`)] as const),
              directions: DIRECTIONS.map((key) => [key, t(`enum.direction.${key}`)] as const),
              styles: ROW_STYLES.map((key) => [key, t(`enum.style.${key}`)] as const),
              strategies: vocabulary.strategies.map((value) => [value, value] as const),
            }}
          />

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
          <EmptyState>{t('table.empty')}</EmptyState>
        ) : (
          <>
            {/*
             * On a phone the table is 660 pixels wide inside a 340 pixel scroller, which puts
             * P&L and RR — the two numbers this screen exists for — off the right edge behind
             * a sideways scroll nobody discovers. Below the tablet breakpoint the same rows
             * are a list instead, with the figures where the eye already is, and the whole
             * row tappable rather than a 14-pixel notebook icon.
             */}
            <ul className="md:hidden">
              {rows.map((trade) => (
                <li key={trade.key} className="border-line border-b last:border-b-0">
                  <Link
                    href={trade.href}
                    className="hover:bg-raised/60 flex flex-col gap-1 px-4 py-3"
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
                      <Num>
                        {trade.closeAt
                          ? closedAt(trade.closeAt)
                          : '—'}
                      </Num>
                      <span className="flex items-center gap-2">
                        <span>
                          {t('table.risk')} <Num>{trade.risk === null ? '—' : money(trade.risk)}</Num>
                        </span>
                        {trade.journalled ? (
                          <NotebookPen size={13} className="text-brand" aria-label={t('journal.title')} />
                        ) : null}
                        {trade.rating === null ? null : (
                          <span className="text-dim text-[10px] leading-none" dir="ltr">
                            {'★'.repeat(trade.rating)}
                          </span>
                        )}
                        {trade.mood ? <span className="text-dim text-[10px]">{trade.mood}</span> : null}
                      </span>
                    </div>
                  </Link>

                  {/*
                    Outside the Link on purpose. A select nested inside an anchor is opened
                    by a tap that the anchor also handles, so answering a question would
                    navigate away from the row being answered.
                  */}
                  {trade.isPosition ? null : (
                    <div className="px-4 pb-3">
                      <ReviewControl
                        tradeId={trade.key.replace('trade:', '')}
                        tpTiming={trade.tpTiming}
                        tookOriginalTp={trade.tookOriginalTp}
                        labels={reviewLabels}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>

            <div className="hidden overflow-x-auto md:block">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="text-dim text-[11px]">
                  {[
                    t('table.closed'),
                    t('table.symbol'),
                    '',
                    t('table.direction'),
                    t('table.style'),
                    t('table.risk'),
                    t('table.rr'),
                    t('table.pnl'),
                    t('review.tpTiming'),
                    '',
                  ].map((header, index) => (
                    <th
                      key={index}
                      className={`border-line border-b px-3.5 py-2.5 font-semibold ${align}`}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((trade) => (
                  <tr key={trade.key} className="border-line border-b last:border-b-0">
                    <td className="text-dim px-3.5 py-2.5 text-xs whitespace-nowrap">
                      <Num>
                        {trade.closeAt
                          ? closedAt(trade.closeAt)
                          : '—'}
                      </Num>
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
                      {t(`enum.style.${trade.style}`)}
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
          </>
        )}
      </Card>

      {pages > 1 ? (
        <Pager
          page={page}
          pages={pages}
          labels={{
            prev: t('table.prev'),
            next: t('table.next'),
            page: t('table.page', { page: formatNumber(page, locale), total: formatNumber(pages, locale) }),
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
