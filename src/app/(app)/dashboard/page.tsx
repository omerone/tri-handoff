import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { EmptyState, KPI, Num } from '@/components/ui/kpi';
import { EquityChart } from '@/components/charts/equity-chart';
import { RStrip } from '@/components/charts/r-strip';
import { requireSession } from '@/lib/auth/session';
import { computeMetrics, equityCurve, maxDrawdown, maxRunUp, recentDailyR, streaks } from '@/lib/analytics';
import { loadBook } from '@/lib/analytics/load';
import { currentResolvedRange } from '@/lib/preferences/range';
import { toTradeFilter } from '@/lib/time/range';
import { getDashboardLayout, listSnapshots } from '@/lib/db';
import { normalizeLayout, type WidgetId } from '@/lib/dashboard/layout';
import { DashboardGrid } from './grid';
import { LOCALE_DIR, type Locale } from '@/i18n/config';
import { displayMoney } from '@/lib/money/display';
import { formatNumber, formatPercent } from '@/lib/money/currency';

/**
 * SPEC §1.1's strip, in days. Thirty is a month a trader can hold in their head, and it is
 * what the strip shows whenever the range is unbounded.
 */
const R_STRIP_DAYS = 30;

/**
 * How many days the strip will stretch to for a chosen range.
 *
 * A quarter still reads as a strip; a two-year range would be seven hundred bars two pixels
 * wide, which is a texture rather than a chart. Past this the strip goes back to its own
 * thirty-day window — the header says which, so the number under it is never ambiguous.
 */
const R_STRIP_MAX_DAYS = 92;
import { formatDayMonthAt, formatTimeAt, isoToDayMonth, isoToWeekdayDate } from '@/lib/time/format';

/**
 * The dashboard from the prototype: six KPI tiles, the R-strip, the equity curve and the
 * recent-trades panel — laid out the way the user arranged them (SPEC §1.1).
 *
 * Every widget is rendered here, on the server, and handed to the grid as a node. The client
 * component decides where each one sits and nothing else, so the trades, the FX rate and the
 * money formatting never reach the browser as data.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const session = await requireSession();
  const t = await getTranslations();
  const locale = (await getLocale()) as Locale;
  const rtl = LOCALE_DIR[locale] === 'rtl';

  const range = await currentResolvedRange((await searchParams).range);
  const window = toTradeFilter(range);
  const book = await loadBook(session.ctx, window);
  const { money, display, converted } = await displayMoney({
    source: book.accountCurrency,
    display: session.user.displayCurrency,
    locale,
  });

  if (book.trades.length === 0) {
    return (
      <Card title={t('nav.dash')}>
        {/* Two different statements, and telling them apart matters: an empty *window* is not
            an empty account, and offering to connect a broker to someone who already has one
            reads as the sync having failed. */}
        <EmptyState>{range.bounded ? t('range.empty') : t('dash.empty')}</EmptyState>
      </Card>
    );
  }

  const [layout, snapshots] = await Promise.all([
    getDashboardLayout(session.ctx).then(normalizeLayout),
    // The broker's own balance, one point per day, narrowed by the same window as the book.
    listSnapshots(session.ctx, { from: window.from, to: window.to }),
  ]);

  const metrics = computeMetrics(book.trades);
  const curve = equityCurve(book.trades, book.openingBalance);
  const drawdown = maxDrawdown(curve, book.openingBalance);
  // The same curve read the other way up — see maxRunUp. Cheap enough to compute beside it,
  // and the pair is only legible together.
  const runUp = maxRunUp(curve, book.openingBalance);
  const run = streaks(book.trades);
  const balance = book.openingBalance + metrics.net;

  const recent = [...book.trades].slice(-6).reverse();

  // Thirty calendar days rather than the last sixty trades: "the last sixty" is a different
  // span every time it is read, and six bars could be six days or one busy afternoon. A chosen
  // range replaces that window with itself, so the strip is the period the rest of the screen
  // is about rather than a second, unrelated one.
  const stripDays =
    range.days !== null && range.days <= R_STRIP_MAX_DAYS ? range.days : R_STRIP_DAYS;
  const days = recentDailyR(book.trades, stripDays);
  const tradingDays = days.filter((day) => day.count > 0).length;

  const widgets: Record<WidgetId, ReactNode> = {
    balance: (
      <KPI
        label={t('kpi.balance')}
        value={money(balance)}
        sub={t('kpi.tradesCount', { count: metrics.count })}
      />
    ),
    netPnl: (
      <KPI
        label={t('kpi.netPnl')}
        value={money(metrics.net, { signed: true })}
        tone={metrics.net >= 0 ? 'pos' : 'neg'}
      />
    ),
    winRate: (
      <KPI
        label={t('kpi.winRate')}
        value={formatPercent(metrics.winRate, locale)}
        sub={`${metrics.wins}/${metrics.count}`}
      />
    ),
    avgRr: (
      <KPI
        label={t('kpi.avgRR')}
        value={metrics.avgRr === null ? '—' : `${formatNumber(metrics.avgRr, locale, 2)}R`}
        tone={(metrics.avgRr ?? 0) >= 0 ? 'pos' : 'neg'}
        // RR is the client's headline metric, so how much of the book it actually covers
        // travels with it rather than being buried on another screen.
        sub={t('kpi.rrCoverage', { percent: formatNumber(metrics.rrCoverage.percent, locale) })}
      />
    ),
    profitFactor: (
      <KPI
        label={t('kpi.profitFactor')}
        value={
          Number.isFinite(metrics.profitFactor)
            ? formatNumber(metrics.profitFactor, locale, 2)
            : '∞'
        }
      />
    ),
    maxDd: (
      <KPI
        label={t('kpi.maxDD')}
        value={money(-drawdown.maxDrawdown)}
        tone="neg"
        /*
         * The percentage is of the peak at the time, and a peak at or below zero has no base
         * to be a fraction of — an account funded from nothing starts there. The engine
         * returns 0 in that case rather than an infinity, which is right, but printing "0.0%"
         * under a real drawdown states something false. Absent says what is true: there is a
         * figure, and no percentage to go with it.
         */
        sub={
          drawdown.maxDrawdownPercent > 0
            ? formatPercent(drawdown.maxDrawdownPercent, locale)
            : undefined
        }
      />
    ),
    maxProfit: (
      <KPI
        label={t('kpi.maxProfit')}
        value={money(runUp.maxRunUp, { signed: true })}
        tone="pos"
        // Same reasoning as the drawdown above.
        sub={runUp.maxRunUpPercent > 0 ? formatPercent(runUp.maxRunUpPercent, locale) : undefined}
      />
    ),
    streak: (
      /*
       * The run the book is on, and the worst and best it has been on.
       *
       * A profit factor cannot say this: eight wins and four losses is the same ratio whether
       * the losses were spread out or arrived in a row on one afternoon, and only the second
       * is the one that makes someone double their size to win it back.
       */
      <KPI
        label={t('kpi.streak')}
        value={
          run.current === 0
            ? t('kpi.streakNone')
            : run.current > 0
              ? t('kpi.streakWins', { count: run.current })
              : t('kpi.streakLosses', { count: -run.current })
        }
        tone={run.current === 0 ? 'neutral' : run.current > 0 ? 'pos' : 'neg'}
        sub={t('kpi.longestRuns', { wins: run.longestWin, losses: run.longestLoss })}
      />
    ),
    expectancy: (
      /*
       * What the average trade is worth, which is the figure position sizing is actually
       * built on. It has been computed on every dashboard load since the first release, and
       * both translations were already written — only the tile was missing.
       */
      <KPI
        label={t('kpi.expectancy')}
        value={money(metrics.expectancy, { signed: true })}
        tone={metrics.expectancy >= 0 ? 'pos' : 'neg'}
        sub={t('kpi.tradesCount', { count: metrics.count })}
      />
    ),
    avgWin: (
      <KPI label={t('kpi.avgWin')} value={money(metrics.avgWin)} tone="pos" />
    ),
    avgLoss: (
      // Stored as a positive magnitude; shown negative, because it is money leaving.
      <KPI label={t('kpi.avgLoss')} value={money(-Math.abs(metrics.avgLoss))} tone="neg" />
    ),
    rStrip: (
      // Collapsible, because this is the one panel whose narrow layout is a list rather than a
      // chart: thirty days as rows is most of a phone screen, and everything the trader
      // arranged under it starts below the fold.
      //
      // Closed to start with on a phone — the header still carries the headline ("18 trading
      // days"), and the day-by-day detail is a thing a trader goes looking for rather than
      // something they need in the way of the tiles and the curve. Open on a desktop, where
      // the same panel is a strip two rows tall.
      <CollapsibleCard
        defaultOpen={false}
        title={t('dash.rStrip', { days: stripDays })}
        action={
          <span className="text-dim text-[11px]">
            {t('dash.rStripTradingDays', { count: tradingDays })}
          </span>
        }
      >
        <RStrip
          days={days}
          labels={{
            formatDayMonth: isoToDayMonth,
            formatLongDate: (date) => isoToWeekdayDate(date, locale),
            formatR: (value) => `${value >= 0 ? '+' : ''}${formatNumber(value, locale, 2)}R`,
            formatMoney: (value) => money(value, { signed: true }),
            formatPercent: (value) => formatPercent(value, locale),
            tradeCount: (count) => t('kpi.tradesCount', { count }),
            noTrades: t('dash.noTrades'),
            netR: t('dash.dayNetR'),
            netPnl: t('kpi.netPnl'),
            winRate: t('kpi.winRate'),
            rrCoverage: (counted, total) => t('dash.dayRrCoverage', { counted, total }),
          }}
        />
      </CollapsibleCard>
    ),
    equity: (
      <Card title={t('dash.equity')}>
        <EquityChart
          data={curve.map((point) => ({
            index: point.index,
            balance: point.balance,
            label: `${formatDayMonthAt(point.closeAt)} ${formatTimeAt(point.closeAt)}`,
          }))}
          startBalance={book.openingBalance}
          rtl={rtl}
          display={display}
        />
      </Card>
    ),
    balanceHistory: (
      /*
        Only once there is more than one point. A single reading is a dot, and a chart of one
        dot claims to show a trend it cannot — the card stays out of the way until the account
        has been synced on two different days, which is when it starts meaning something.
      */
      snapshots.length > 1 ? (
        <Card title={t('dash.balanceHistory')}>
          <EquityChart
            data={snapshots.map((snapshot, index) => ({
              index: index + 1,
              balance: snapshot.balance,
              label: formatDayMonthAt(snapshot.at),
            }))}
            startBalance={snapshots[0]!.balance}
            rtl={rtl}
            display={display}
          />
          <p className="text-dim mt-3 text-[11px] leading-relaxed">
            {t('dash.balanceHistoryNote')}
          </p>
        </Card>
      ) : null
    ),
    recent: (
      <Card title={t('dash.recent')}>
        <div className="flex flex-col gap-2">
          {recent.map((trade) => (
            <div
              key={trade.id}
              className="border-line flex items-center justify-between border-b py-1.5 last:border-b-0"
            >
              <div className="flex items-center gap-2">
                {trade.direction === 'long' ? (
                  <ArrowUpRight size={14} className="text-pos" aria-hidden />
                ) : (
                  <ArrowDownRight size={14} className="text-neg" aria-hidden />
                )}
                <div>
                  <div className="text-[13px] font-bold">{trade.symbol}</div>
                  <div className="text-dim text-[11px]">
                    {t(`enum.assetClass.${trade.assetClass}`)} · {t(`enum.style.${trade.style}`)}
                  </div>
                </div>
              </div>
              <div className={rtl ? 'text-left' : 'text-right'}>
                <div
                  className={`text-[13px] font-bold ${trade.profit >= 0 ? 'text-pos' : 'text-neg'}`}
                >
                  <Num>{money(trade.profit, { signed: true })}</Num>
                </div>
                <div className="text-dim text-[11px]">
                  <Num>{trade.rr === null ? '—' : `${formatNumber(trade.rr, locale, 2)}R`}</Num>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    ),
  };

  // The names the screen reader reads out while a card is being moved: the same headings the
  // cards already carry, so "move net P&L" refers to something the user can see.
  const names: Record<WidgetId, string> = {
    balance: t('kpi.balance'),
    netPnl: t('kpi.netPnl'),
    winRate: t('kpi.winRate'),
    avgRr: t('kpi.avgRR'),
    profitFactor: t('kpi.profitFactor'),
    maxDd: t('kpi.maxDD'),
    maxProfit: t('kpi.maxProfit'),
    streak: t('kpi.streak'),
    expectancy: t('kpi.expectancy'),
    avgWin: t('kpi.avgWin'),
    avgLoss: t('kpi.avgLoss'),
    rStrip: t('dash.rStrip', { days: stripDays }),
    equity: t('dash.equity'),
    balanceHistory: t('dash.balanceHistory'),
    recent: t('dash.recent'),
  };

  return (
    <div className="flex flex-col gap-4">
      <DashboardGrid
        initial={layout}
        widgets={widgets}
        names={names}
        rtl={rtl}
      />

      {!converted ? (
        <p className="text-warn text-xs">{t('kpi.fxUnavailable', { currency: book.accountCurrency })}</p>
      ) : null}
    </div>
  );
}
