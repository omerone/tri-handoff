import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { EmptyState, KPI, Num } from '@/components/ui/kpi';
import { EquityChart } from '@/components/charts/equity-chart';
import { RStrip } from '@/components/charts/r-strip';
import { requireSession } from '@/lib/auth/session';
import { computeMetrics, equityCurve, maxDrawdown } from '@/lib/analytics';
import { loadBook } from '@/lib/analytics/load';
import { getDashboardLayout } from '@/lib/db';
import { normalizeLayout, type WidgetId } from '@/lib/dashboard/layout';
import { DashboardGrid } from './grid';
import { LOCALE_DIR, LOCALE_TAG, type Locale } from '@/i18n/config';
import { displayMoney } from '@/lib/money/display';
import { formatNumber, formatPercent } from '@/lib/money/currency';

/**
 * The dashboard from the prototype: six KPI tiles, the R-strip, the equity curve and the
 * recent-trades panel — laid out the way the user arranged them (SPEC §1.1).
 *
 * Every widget is rendered here, on the server, and handed to the grid as a node. The client
 * component decides where each one sits and nothing else, so the trades, the FX rate and the
 * money formatting never reach the browser as data.
 */
export default async function DashboardPage() {
  const session = await requireSession();
  const t = await getTranslations();
  const locale = (await getLocale()) as Locale;
  const rtl = LOCALE_DIR[locale] === 'rtl';

  const book = await loadBook(session.ctx);
  const { money, display, converted } = await displayMoney({
    source: book.accountCurrency,
    display: session.user.displayCurrency,
    locale,
  });

  if (book.trades.length === 0) {
    return (
      <Card title={t('nav.dash')}>
        <EmptyState>{t('dash.empty')}</EmptyState>
      </Card>
    );
  }

  const layout = normalizeLayout(await getDashboardLayout(session.ctx));

  const metrics = computeMetrics(book.trades);
  const curve = equityCurve(book.trades, book.startBalance);
  const drawdown = maxDrawdown(curve, book.startBalance);
  const balance = book.startBalance + metrics.net;

  const dateTime = new Intl.DateTimeFormat(LOCALE_TAG[locale], {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const recent = [...book.trades].slice(-6).reverse();
  const strip = book.trades.slice(-60);

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
        sub={formatPercent(drawdown.maxDrawdownPercent, locale)}
      />
    ),
    rStrip: (
      <Card title={t('dash.rStrip')}>
        <RStrip
          trades={strip.map((trade) => ({
            id: trade.id,
            symbol: trade.symbol,
            rr: trade.rr,
            profit: trade.profit,
          }))}
          formatRr={(rr) => `${formatNumber(rr, locale, 2)}R`}
        />
      </Card>
    ),
    equity: (
      <Card title={t('dash.equity')}>
        <EquityChart
          data={curve.map((point) => ({
            index: point.index,
            balance: point.balance,
            label: dateTime.format(point.closeAt),
          }))}
          startBalance={book.startBalance}
          rtl={rtl}
          display={display}
        />
      </Card>
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
    rStrip: t('dash.rStrip'),
    equity: t('dash.equity'),
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
