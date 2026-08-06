import { getLocale, getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/card';
import { KPI } from '@/components/ui/kpi';
import { requireSession } from '@/lib/auth/session';
import { computeMetrics } from '@/lib/analytics';
import { getMt5Account, listTradesByStyle } from '@/lib/db';
import { LOCALE_DIR, type Locale } from '@/i18n/config';
import { formatNumber } from '@/lib/money/currency';
import { displayMoney } from '@/lib/money/display';
import { formatDateAt } from '@/lib/time/format';
import { wallClock } from '@/lib/time/zone';
import { ManualTradeForm, type ManualTradeLabels } from './manual-trade-form';
import { ManualTradeList, type ManualTradeView } from './manual-trade-list';

/**
 * One of the two hand-typed books, Day or Swing.
 *
 * A trade entered here is not a second-class copy of a synced one — it is the same row shape
 * in the same table, so the moment it is saved it appears in the trades table, the calendar,
 * the equity curve, the costs card and every breakdown on the analytics screen. That is the
 * whole design: the journal has to be worth keeping before a broker is connected, and a
 * separate store for manual entries would have meant every one of those screens learning
 * about two kinds of trade.
 *
 * The figures at the top are computed over this book alone, which is deliberately *not* what
 * the dashboard shows. Here the question is "how is the thing I am typing in going", and
 * mixing in a synced book would answer a different one.
 */
export async function ManualBook({ style }: { style: 'day' | 'swing' }) {
  const session = await requireSession();
  const t = await getTranslations('manual');
  const tTable = await getTranslations('table');
  const tEnum = await getTranslations('enum');
  const tJournal = await getTranslations('journal');
  const locale = (await getLocale()) as Locale;
  const rtl = LOCALE_DIR[locale] === 'rtl';

  const [trades, account] = await Promise.all([
    listTradesByStyle(session.ctx, style),
    getMt5Account(session.ctx),
  ]);

  const { money } = await displayMoney({
    source: account?.accountCurrency ?? 'USD',
    display: session.user.displayCurrency,
    locale,
  });

  /*
   * The same engine the analytics screen runs on, over this book only.
   *
   * `computeMetrics` wants the analytics shape rather than the row shape, and the fields it
   * actually reads are the outcome ones — everything else can be a placeholder. Mapping it
   * here rather than exporting another loader keeps the one list this component already has.
   */
  const metrics = computeMetrics(
    trades
      .filter((trade) => trade.closeAt !== null)
      .map((trade) => ({
        id: trade.id,
        symbol: trade.symbol,
        assetClass: trade.assetClass,
        direction: trade.direction,
        style: trade.style,
        openAt: trade.openAt,
        closeAt: trade.closeAt!,
        profit: trade.profit,
        commission: trade.commission,
        swap: trade.swap,
        volume: trade.volume,
        risk: trade.risk,
        rr: trade.rr,
        mae: null,
        mfe: null,
        strategy: null,
        rating: null,
        mood: null,
        tpTiming: null,
        tookOriginalTp: null,
      })),
  );

  const today = wallClock(new Date());
  const defaultDate = `${today.year}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}`;

  /** `YYYY-MM-DD` in the analytics zone — what a date input accepts, unlike `formatDateAt`. */
  const dateValue = (at: Date | null) => {
    if (at === null) return '';
    const { year, month, day } = wallClock(at);
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };
  /** Empty rather than "0" for an absent optional, so the field looks unset because it is. */
  const numValue = (value: number | null) => (value === null ? '' : String(value));

  /*
   * One set of field labels for the add form and for every row's editor. They are the same
   * fields, so two lists would be two chances for "P&L" in one place and "Profit" in the other.
   */
  const formLabels: ManualTradeLabels = {
    symbol: tTable('symbol'),
    symbolHint: t('symbolHint'),
    direction: tTable('direction'),
    long: tEnum('direction.long'),
    short: tEnum('direction.short'),
    date: tTable('closed'),
    profit: tTable('pnl'),
    risk: tTable('risk'),
    riskHint: t('riskHint'),
    add: t('add'),
    more: t('more'),
    moreHint: t('moreHint'),
    openDate: tTable('opened'),
    volume: tTable('volume'),
    entryPrice: tJournal('entry'),
    exitPrice: tJournal('exit'),
    stopLoss: tJournal('stopLoss'),
    takeProfit: tJournal('takeProfit'),
    commission: tJournal('commission'),
    swap: tJournal('swap'),
  };

  const rows: ManualTradeView[] = trades.map((trade) => ({
    id: trade.id,
    symbol: trade.symbol,
    assetClassLabel: tEnum(`assetClass.${trade.assetClass}`),
    direction: trade.direction,
    directionLabel: tEnum(`direction.${trade.direction}`),
    closedAt: trade.closeAt ? formatDateAt(trade.closeAt) : '—',
    profit: money(trade.profit, { signed: true }),
    profitPositive: trade.profit >= 0,
    risk: trade.risk === null ? null : money(trade.risk),
    rr:
      trade.rr === null
        ? null
        : `${trade.rr >= 0 ? '+' : ''}${formatNumber(trade.rr, locale, 2)}R`,
    rrPositive: (trade.rr ?? 0) >= 0,
    journalled: trade.journalled,
    isManual: trade.isManual,
    style: trade.style,
    edit: {
      symbol: trade.symbol,
      direction: trade.direction,
      closeDate: dateValue(trade.closeAt),
      openDate: dateValue(trade.openAt),
      /*
       * The stored figures, not the displayed ones. The table renders money converted into the
       * reader's display currency; the form has to round-trip what is actually in the row, or
       * saving an untouched edit would silently rewrite the trade in shekels.
       */
      profit: String(trade.profit),
      risk: numValue(trade.risk),
      volume: trade.volume === 0 ? '' : String(trade.volume),
      entryPrice: trade.entryPrice === 0 ? '' : String(trade.entryPrice),
      exitPrice: numValue(trade.exitPrice),
      stopLoss: numValue(trade.stopLoss),
      takeProfit: numValue(trade.takeProfit),
      commission: trade.commission === 0 ? '' : String(trade.commission),
      swap: trade.swap === 0 ? '' : String(trade.swap),
    },
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KPI label={t('count')} value={formatNumber(metrics.count, locale)} />
        <KPI
          label={t('net')}
          value={money(metrics.net, { signed: true })}
          tone={metrics.net >= 0 ? 'pos' : 'neg'}
        />
        <KPI
          label={t('winRate')}
          value={metrics.count === 0 ? '—' : `${formatNumber(metrics.winRate, locale, 0)}%`}
          sub={metrics.count === 0 ? undefined : t('wins', { wins: metrics.wins, total: metrics.count })}
        />
        <KPI
          label={t('avgRr')}
          value={metrics.avgRr === null ? '—' : `${formatNumber(metrics.avgRr, locale, 2)}R`}
          // The same coverage note the dashboard carries: an R computed over a third of the
          // book must not read as one computed over all of it.
          sub={t('rrCoverage', { percent: formatNumber(metrics.rrCoverage.percent, locale, 0) })}
        />
      </div>

      <Card title={t(`${style}Title`)}>
        <p className="text-dim mb-3 text-xs leading-relaxed">{t(`${style}Subtitle`)}</p>

        <div className="border-line border-b pb-3">
          <ManualTradeForm
            style={style}
            defaultDate={defaultDate}
            labels={formLabels}
          />
        </div>

        <ManualTradeList
          trades={rows}
          rtl={rtl}
          labels={{
            columns: {
              symbol: tTable('symbol'),
              direction: tTable('direction'),
              date: tTable('closed'),
              risk: tTable('risk'),
              rr: tTable('rr'),
              pnl: tTable('pnl'),
            },
            empty: t('empty'),
            row: {
              journal: tJournal('title'),
              edit: t('edit'),
      synced: t('syncedRow'),
              cancel: t('cancel'),
              save: t('save'),
              delete: t('delete'),
              deleteConfirm: t('deleteConfirm'),
              fields: formLabels,
            },
          }}
        />
      </Card>
    </div>
  );
}
