import { getLocale, getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/card';
import { EmptyState, KPI } from '@/components/ui/kpi';
import { requireSession } from '@/lib/auth/session';
import { listLongPositions, type StoredLongPosition } from '@/lib/db';
import {
  isStale,
  portfolioTotals,
  valuePosition,
  type LongPosition,
} from '@/lib/positions/valuation';
import { LOCALE_DIR, type Locale } from '@/i18n/config';
import {
  asCurrency,
  formatMoney,
  formatNumber,
  formatPercent,
  SUPPORTED_CURRENCIES,
  type Currency,
} from '@/lib/money/currency';
import { getFxRate, hasRate } from '@/lib/money/fx';
import { wallClock } from '@/lib/time/zone';
import { AddPositionForm } from './add-form';
import { PositionRow } from './position-row';
import { trackAllAction } from './actions';
import { formatDateAt } from '@/lib/time/format';

/**
 * Long-term positions (SPEC §3.4): the holdings that live outside MT5 and are marked to
 * market by hand.
 *
 * Positions can be held in different currencies, so the totals convert each one into the
 * user's display currency before adding them up. Per-position figures stay in the currency
 * the position is actually denominated in — converting a per-share price would be actively
 * confusing when the user goes to compare it with their broker.
 */
export default async function LongPositionsPage() {
  const session = await requireSession();
  const t = await getTranslations('long');
  const locale = (await getLocale()) as Locale;
  const rtl = LOCALE_DIR[locale] === 'rtl';

  const positions = await listLongPositions(session.ctx);
  const now = new Date();
  const display = asCurrency(session.user.displayCurrency);

  // One rate per currency actually held, resolved in parallel.
  //
  // A missing rate used to fall back to 1:1 *per currency*, so a portfolio holding EUR and
  // GBP with only one rate available produced totals that mixed converted and unconverted
  // legs — a single number that was wrong in a way nothing on the page could reveal. Now a
  // missing rate withholds the totals and says so.
  const currencies = [...new Set(positions.map((p) => p.currency))];
  const rates = new Map<string, number>();
  let allConverted = true;
  await Promise.all(
    currencies.map(async (currency) => {
      const fx = await getFxRate(currency, display);
      if (hasRate(fx)) rates.set(currency, fx.rate);
      else allConverted = false;
    }),
  );
  const toDisplay = (amount: number, currency: string) => amount * (rates.get(currency) ?? 1);

  const money = (amount: number, currency: Currency, options: { signed?: boolean } = {}) =>
    formatMoney(amount, currency, locale, { decimals: 2, ...options });

  // Converted to one currency before summing, since a portfolio can mix them.
  const converted: LongPosition[] = positions.map((position) => ({
    ...position,
    buyPrice: toDisplay(position.buyPrice, position.currency),
    currentPrice: toDisplay(position.currentPrice, position.currency),
    fees: toDisplay(position.fees, position.currency),
    realizedPnl:
      position.realizedPnl === null ? null : toDisplay(position.realizedPnl, position.currency),
  }));
  const totals = portfolioTotals(converted, now);

  const today = wallClock(now);
  const defaultDate = `${today.year}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}`;

  const open = positions.filter((position) => position.closedAt === null);
  const closed = positions.filter((position) => position.closedAt !== null);

  const rowFor = (position: StoredLongPosition) => {
    const valuation = valuePosition(position, now);
    const currency = asCurrency(position.currency, 'USD');
    return {
      id: position.id,
      symbol: position.symbol,
      qty: formatNumber(position.qty, locale, position.qty % 1 === 0 ? 0 : 4),
      buyPrice: money(position.buyPrice, currency),
      currentPrice: money(position.currentPrice, currency),
      currentPriceValue: position.currentPrice,
      value: money(valuation.value, currency),
      unrealized: money(valuation.unrealized, currency, { signed: true }),
      unrealizedPositive: valuation.unrealized >= 0,
      unrealizedPercent: formatPercent(valuation.unrealizedPercent, locale),
      updatedAt: formatDateAt(position.valueUpdatedAt),
      staleMessage: isStale(valuation)
        ? t('staleWarning', { days: valuation.priceAgeDays })
        : null,
      tracked: position.priceSource === 'auto',
      closed: position.closedAt !== null,
      realized:
        position.realizedPnl === null
          ? null
          : money(position.realizedPnl, currency, { signed: true }),
      realizedPositive: (position.realizedPnl ?? 0) >= 0,
    };
  };

  const labels = {
    // Repeated on every cell so the stacked mobile layout can label each figure — see the
    // `tri-stack` rule in globals.css.
    columns: {
      qty: t('qty'),
      buyPrice: t('buyPrice'),
      currentValue: t('currentValue'),
      value: t('value'),
      unrealized: t('unrealized'),
      updated: t('updated'),
    },
    update: t('update'),
    newPrice: t('newPrice'),
    close: t('close'),
    closeTitle: t('closeTitle'),
    sellPrice: t('sellPrice'),
    delete: t('delete'),
    deleteConfirm: t('deleteConfirm'),
    updated: t('updated'),
    cancel: (await getTranslations('finance'))('cancel'),
    auto: t('auto'),
    autoOn: t('autoOn'),
    autoOff: t('autoOff'),
  };

  // Offered only while there is something to switch — once the book is on the feed the
  // button is an invitation to do nothing.
  const untracked = open.filter((position) => position.priceSource !== 'auto').length;

  const headers = [
    t('symbol'),
    t('qty'),
    t('buyPrice'),
    t('currentValue'),
    t('value'),
    t('unrealized'),
    t('updated'),
    '',
  ];
  const align = rtl ? 'text-right' : 'text-left';

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KPI
          label={t('cost')}
          value={allConverted ? formatMoney(totals.cost, display, locale) : '—'}
        />
        <KPI
          label={t('value')}
          value={allConverted ? formatMoney(totals.value, display, locale) : '—'}
        />
        <KPI
          label={t('unrealized')}
          value={
            allConverted ? formatMoney(totals.unrealized, display, locale, { signed: true }) : '—'
          }
          tone={totals.unrealized >= 0 ? 'pos' : 'neg'}
          sub={allConverted ? formatPercent(totals.unrealizedPercent, locale) : undefined}
        />
        <KPI
          label={t('realized')}
          value={
            allConverted ? formatMoney(totals.realized, display, locale, { signed: true }) : '—'
          }
          tone={totals.realized >= 0 ? 'pos' : 'neg'}
          // The stalest price is the honest headline for how current the valuation is; an
          // average would hide a holding nobody has looked at since spring.
          sub={totals.openCount > 0 ? t('stalest', { days: totals.stalestPriceDays }) : undefined}
        />
      </div>

      {allConverted ? null : <p className="text-warn text-xs">{t('fxUnavailable')}</p>}

      <Card title={t('title')}>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-dim text-xs">{t('subtitle')}</p>
          {untracked > 0 ? (
            <form action={trackAllAction}>
              <button
                type="submit"
                className="border-line bg-raised text-brand rounded-lg border px-2 py-1 text-[11px]"
              >
                {t('trackAll', { count: untracked })}
              </button>
            </form>
          ) : null}
        </div>
        <div className="border-line border-b pb-3">
          <AddPositionForm
            labels={{
              symbol: t('symbol'),
              searchHint: t('searchHint'),
              searching: t('searching'),
              noMatches: t('noMatches'),
              qty: t('qty'),
              buyPrice: t('buyPrice'),
              buyDate: t('buyDate'),
              fees: t('fees'),
              currency: t('currency'),
              add: t('add'),
            }}
            currencies={SUPPORTED_CURRENCIES}
            defaultDate={defaultDate}
          />
        </div>

        {positions.length === 0 ? (
          <EmptyState>{t('empty')}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="tri-stack w-full border-collapse text-[13px]">
              <thead>
                <tr className="text-dim text-[11px]">
                  {headers.map((header, index) => (
                    <th
                      key={index}
                      className={`border-line border-b px-3 py-2.5 font-semibold ${align}`}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {open.map((position) => (
                  <PositionRow key={position.id} position={rowFor(position)} labels={labels} />
                ))}
              </tbody>

              {closed.length > 0 ? (
                <>
                  <thead className="tri-stack-keep">
                    <tr>
                      <th
                        colSpan={headers.length}
                        className={`text-dim border-line border-y px-3 py-2 text-[11px] font-semibold ${align}`}
                      >
                        {t('closed')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="opacity-70">
                    {closed.map((position) => (
                      <PositionRow key={position.id} position={rowFor(position)} labels={labels} />
                    ))}
                  </tbody>
                </>
              ) : null}
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
