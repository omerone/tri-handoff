import { getLocale, getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/card';
import { EmptyState, Num } from '@/components/ui/kpi';
import { BreakdownChart, type BreakdownDatum } from '@/components/charts/breakdown-chart';
import { requireSession } from '@/lib/auth/session';
import {
  bestConditions,
  byAssetClass,
  byDirection,
  bySession,
  byWeekday,
  heatmap,
  type Bucket,
  type Metrics,
} from '@/lib/analytics';
import { loadBook } from '@/lib/analytics/load';
import { LOCALE_DIR, LOCALE_TAG, type Locale } from '@/i18n/config';
import { formatNumber } from '@/lib/money/currency';
import { displayMoney } from '@/lib/money/display';
import { RGB, rgba } from '@/lib/theme';
import { SESSIONS, WEEKDAYS } from '@/lib/analytics/dimensions';

/**
 * "Where am I most profitable" — SPEC §3.5, and the reason the product exists beyond a
 * balance sheet.
 */
export default async function AnalyticsPage() {
  const session = await requireSession();
  const t = await getTranslations();
  const locale = (await getLocale()) as Locale;
  const rtl = LOCALE_DIR[locale] === 'rtl';

  const book = await loadBook(session.ctx);
  const { money, display } = await displayMoney({
    source: book.accountCurrency,
    display: session.user.displayCurrency,
    locale,
  });

  if (book.trades.length === 0) {
    return (
      <Card title={t('nav.analytics')}>
        <EmptyState>{t('dash.empty')}</EmptyState>
      </Card>
    );
  }

  // Short weekday names, not the calendar's single letters. Those work in a seven-column
  // grid where position disambiguates them; standing alone in an insight card, "T" could be
  // Tuesday or Thursday, and "M" next to "Swing" and "Stocks" reads as nothing at all.
  const weekdayFormat = new Intl.DateTimeFormat(LOCALE_TAG[locale], {
    weekday: 'short',
    timeZone: 'UTC',
  });
  // 2026-02-01 was a Sunday, so index 0..6 maps straight onto Sunday..Saturday.
  const weekdayNames = Array.from({ length: 7 }, (_, index) =>
    weekdayFormat.format(new Date(Date.UTC(2026, 1, 1 + index))),
  );

  const caption = (metrics: Metrics): string =>
    metrics.count === 0
      ? '—'
      : `${metrics.avgRr === null ? '—' : `${formatNumber(metrics.avgRr, locale, 2)}R`} · ${formatNumber(metrics.winRate, locale, 0)}%`;

  const toData = (buckets: Bucket<string>[], label: (key: string) => string): BreakdownDatum[] =>
    buckets.map((bucket) => ({
      key: bucket.key,
      label: label(bucket.key),
      net: bucket.metrics.net,
      caption: caption(bucket.metrics),
    }));

  const weekdayLabel = (key: string) => weekdayNames[Number(key)] ?? key;

  const charts: { title: string; data: BreakdownDatum[] }[] = [
    { title: t('analytics.byWeekday'), data: toData(byWeekday(book.trades), weekdayLabel) },
    {
      title: t('analytics.bySession'),
      data: toData(bySession(book.trades), (key) => t(`enum.session.${key}`)),
    },
    {
      title: t('analytics.byClass'),
      // Classes with no trades would be four empty bars on most books.
      data: toData(
        byAssetClass(book.trades).filter((b) => b.metrics.count > 0),
        (key) => t(`enum.assetClass.${key}`),
      ),
    },
    {
      title: t('analytics.byDirection'),
      data: toData(byDirection(book.trades), (key) => t(`enum.direction.${key}`)),
    },
  ];

  const insights = bestConditions(book.trades);
  const cells = heatmap(book.trades);
  const maxAbs = Math.max(1, ...cells.map((cell) => Math.abs(cell.net)));

  const insightLabel = (dimension: string, key: string): string => {
    if (dimension === 'weekday') return weekdayLabel(key);
    if (dimension === 'session') return t(`enum.session.${key}`);
    if (dimension === 'assetClass') return t(`enum.assetClass.${key}`);
    if (dimension === 'direction') return t(`enum.direction.${key}`);
    return t(`enum.style.${key}`);
  };

  return (
    <div className="flex flex-col gap-4">
      <Card title={t('analytics.insights')}>
        {insights.length === 0 ? (
          <EmptyState>{t('analytics.noData')}</EmptyState>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {insights.map((insight, index) => (
                <div
                  key={`${insight.dimension}:${insight.key}`}
                  className={`bg-raised rounded-[14px] border px-3 py-2.5 ${
                    index === 0 ? 'border-pos' : 'border-line'
                  }`}
                >
                  <div className="text-dim text-xs">
                    {insightLabel(insight.dimension, insight.key)}
                  </div>
                  <div className="text-pos text-lg font-extrabold">
                    <Num>{formatNumber(insight.metrics.avgRr ?? 0, locale, 2)}R</Num>
                  </div>
                  <div className="text-dim text-[11px]">
                    {formatNumber(insight.metrics.winRate, locale, 0)}% ·{' '}
                    {t('kpi.tradesCount', { count: insight.metrics.count })}
                  </div>
                </div>
              ))}
            </div>
            <div className="text-dim mt-2 text-[11px]">{t('analytics.bestNote')}</div>
          </>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {charts.map((chart) => (
          <Card key={chart.title} title={chart.title}>
            <BreakdownChart
              data={chart.data}
              rtl={rtl}
              display={display}
            />
          </Card>
        ))}
      </div>

      <Card title={t('analytics.heatmap')}>
        <div className="overflow-x-auto">
          <div
            className="grid gap-1.5"
            style={{ gridTemplateColumns: '56px repeat(3, minmax(90px, 1fr))', minWidth: 380 }}
          >
            <div />
            {SESSIONS.map((sessionKey) => (
              <div key={sessionKey} className="text-dim text-center text-[11px]">
                {t(`enum.session.${sessionKey}`)}
              </div>
            ))}

            {WEEKDAYS.map((weekday) => (
              <Row
                key={weekday}
                weekday={weekday}
                label={weekdayNames[weekday] ?? String(weekday)}
                cells={cells.filter((cell) => cell.weekday === weekday)}
                maxAbs={maxAbs}
                money={money}
                tradeCount={(count: number) => t('kpi.tradesCount', { count })}
              />
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}

function Row({
  label,
  cells,
  maxAbs,
  money,
  tradeCount,
}: {
  weekday: number;
  label: string;
  cells: { session: string; net: number; count: number }[];
  maxAbs: number;
  money: (value: number, options?: { signed?: boolean }) => string;
  tradeCount: (count: number) => string;
}) {
  return (
    <>
      <div className="text-dim flex items-center text-xs">{label}</div>
      {cells.map((cell) => {
        // Alpha scales with magnitude relative to the strongest cell, plus a floor so an
        // empty square still reads as a square rather than a hole in the grid.
        const alpha = (Math.min(Math.abs(cell.net) / maxAbs, 1) * 0.8 + 0.06).toFixed(3);
        const background = rgba(cell.net >= 0 ? RGB.pos : RGB.neg, Number(alpha));

        return (
          <div
            key={cell.session}
            className="rounded-[10px] px-2.5 py-2 text-center"
            style={{ background }}
          >
            <div className="text-xs font-bold" style={{ color: '#0A0B0F' }}>
              <Num>{money(cell.net, { signed: true })}</Num>
            </div>
            <div className="text-[10px]" style={{ color: 'rgba(10,11,15,0.7)' }}>
              {tradeCount(cell.count)}
            </div>
          </div>
        );
      })}
    </>
  );
}
