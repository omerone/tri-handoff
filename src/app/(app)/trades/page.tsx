import { getLocale, getTranslations } from 'next-intl/server';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import Link from 'next/link';
import { NotebookPen } from 'lucide-react';
import { Chip, EmptyState, Num } from '@/components/ui/kpi';
import { requireSession } from '@/lib/auth/session';
import { computeMetrics, toAnalyticsTrades } from '@/lib/analytics';
import { countTrades, listClosedTrades, pageTrades, type TradeFilter } from '@/lib/db';
import { ASSET_CLASSES, DIRECTIONS, STYLES } from '@/lib/analytics/dimensions';
import { getMt5Account, listJournalVocabulary } from '@/lib/db';
import { LOCALE_DIR, LOCALE_TAG, type Locale } from '@/i18n/config';
import { formatNumber } from '@/lib/money/currency';
import { displayMoney } from '@/lib/money/display';
import { TradeFilters } from './filters';
import { Pager } from './pager';

const PAGE_SIZE = 40;

type SearchParams = {
  class?: string;
  dir?: string;
  style?: string;
  strategy?: string;
  page?: string;
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

  const filter: TradeFilter = {
    ...(isAssetClass(params.class) ? { assetClass: params.class } : {}),
    ...(isDirection(params.dir) ? { direction: params.dir } : {}),
    ...(isStyle(params.style) ? { style: params.style } : {}),
    ...(params.strategy ? { strategy: params.strategy } : {}),
  };

  const page = Math.max(1, Number(params.page) || 1);

  const [total, rows, filteredRecords, account, vocabulary] = await Promise.all([
    countTrades(session.ctx, filter),
    pageTrades(session.ctx, filter, { offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE }),
    // The summary bar reflects the *filter*, not the page — the whole point of narrowing to
    // "short crypto" is seeing what short crypto did overall.
    listClosedTrades(session.ctx, filter),
    getMt5Account(session.ctx),
    listJournalVocabulary(session.ctx),
  ]);

  const metrics = computeMetrics(toAnalyticsTrades(filteredRecords));
  const { money } = await displayMoney({
    source: account?.accountCurrency ?? 'USD',
    display: session.user.displayCurrency,
    locale,
  });

  const dateTime = new Intl.DateTimeFormat(LOCALE_TAG[locale], {
    day: '2-digit',
    month: '2-digit',
  });
  const time = new Intl.DateTimeFormat(LOCALE_TAG[locale], { hour: '2-digit', minute: '2-digit' });

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const align = rtl ? 'text-right' : 'text-left';

  return (
    <div className="flex flex-col gap-4">
      <Card title={t('table.filter')}>
        <div className="flex flex-wrap items-center gap-2">
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
              classes: ASSET_CLASSES.map((key) => [key, t(`enum.assetClass.${key}`)] as const),
              directions: DIRECTIONS.map((key) => [key, t(`enum.direction.${key}`)] as const),
              styles: STYLES.map((key) => [key, t(`enum.style.${key}`)] as const),
              strategies: vocabulary.strategies.map((value) => [value, value] as const),
            }}
          />

          <div className="text-dim flex gap-4 text-xs ms-auto">
            <span>{t('kpi.tradesCount', { count: metrics.count })}</span>
            <span className={metrics.net >= 0 ? 'text-pos' : 'text-neg'}>
              <Num>{money(metrics.net, { signed: true })}</Num>
            </span>
            <Num>{metrics.avgRr === null ? '—' : `${formatNumber(metrics.avgRr, locale, 2)}R`}</Num>
          </div>
        </div>
      </Card>

      <Card pad={false}>
        {rows.length === 0 ? (
          <EmptyState>{t('table.empty')}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
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
                  <tr key={trade.id} className="border-line border-b last:border-b-0">
                    <td className="text-dim px-3.5 py-2.5 text-xs whitespace-nowrap">
                      <Num>
                        {trade.closeAt
                          ? `${dateTime.format(trade.closeAt)} · ${time.format(trade.closeAt)}`
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
                        trade.profit >= 0 ? 'text-pos' : 'text-neg'
                      }`}
                    >
                      <Num>{money(trade.profit, { signed: true })}</Num>
                    </td>
                    <td className="px-3.5 py-2.5 text-end">
                      {/*
                        A filled icon means there is already something written here, so a
                        trader working through a week can see at a glance which trades they
                        have been through.
                      */}
                      <Link
                        href={`/trades/${trade.id}`}
                        aria-label={t('journal.title')}
                        title={trade.strategy ?? t('journal.title')}
                        className={`inline-flex ${hasJournal(trade) ? 'text-brand' : 'text-dim/50 hover:text-text'}`}
                      >
                        <NotebookPen size={14} aria-hidden />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

function hasJournal(trade: {
  note: string | null;
  tags: string[];
  rating: number | null;
  mood: string | null;
  strategy: string | null;
}): boolean {
  return Boolean(
    trade.note || trade.tags.length > 0 || trade.rating || trade.mood || trade.strategy,
  );
}

function isAssetClass(value: unknown): value is (typeof ASSET_CLASSES)[number] {
  return typeof value === 'string' && (ASSET_CLASSES as readonly string[]).includes(value);
}
function isDirection(value: unknown): value is (typeof DIRECTIONS)[number] {
  return typeof value === 'string' && (DIRECTIONS as readonly string[]).includes(value);
}
function isStyle(value: unknown): value is (typeof STYLES)[number] {
  return typeof value === 'string' && (STYLES as readonly string[]).includes(value);
}
