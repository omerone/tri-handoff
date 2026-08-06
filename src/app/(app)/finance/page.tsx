import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/card';
import { EmptyState, KPI, Num } from '@/components/ui/kpi';
import { requireSession } from '@/lib/auth/session';
import { isAtOrBefore, stepMonth } from '@/lib/finance/bounds';
import { applyRangeAction } from '@/app/actions/range';
import { currentResolvedRange } from '@/lib/preferences/range';
import { describeRange } from '@/lib/time/range';
import { getMt5Account, listFinanceEntries, listLongPositions } from '@/lib/db';
import { portfolioTotals } from '@/lib/positions/valuation';
import { cumulativeCash, expensesByCategory, rangeBalance, totalWealth, yearBalance } from '@/lib/finance/balance';
import { isKnownCategory, suggestedCategories } from '@/lib/finance/categories';
import { LOCALE_DIR, type Locale } from '@/i18n/config';
import { formatMoney, formatNumber } from '@/lib/money/currency';
import { displayMoney } from '@/lib/money/display';
import { getFxRate, hasRate } from '@/lib/money/fx';
import { wallClock } from '@/lib/time/zone';
import { EntryForm } from './entry-form';
import { EntryRow } from './entry-row';
import { formatDayMonthAt, type DateParts } from '@/lib/time/format';

/**
 * The personal-finance screen (SPEC §3.1) — the module that makes TRi more than a trading
 * journal.
 *
 * Currency handling is the fiddly part and it is worth stating plainly: finance is stored in
 * shekels, the trading account is in whatever the broker denominates it in, and the user
 * reads everything in one currency of their choosing. So there are two conversions here, not
 * one, and they use different rates.
 */
export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; range?: string }>;
}) {
  const session = await requireSession();
  const t = await getTranslations('finance');
  const locale = (await getLocale()) as Locale;
  const rtl = LOCALE_DIR[locale] === 'rtl';
  const params = await searchParams;

  const [entries, account, positions] = await Promise.all([
    listFinanceEntries(session.ctx),
    getMt5Account(session.ctx),
    listLongPositions(session.ctx),
  ]);

  const today = wallClock(new Date());
  const range = await currentResolvedRange(params.range);

  /*
   * The window this screen is about, and the only thing that decides it.
   *
   * This screen used to carry a second control: `?m=`, stepped by the arrows below, which took
   * over whenever no range was pinned. One screen with two date controls is one too many, and
   * the pair could contradict each other outright — picking "maximum" left the arrows in charge,
   * so the picker said *everything* while the page showed a single month, sometimes an empty
   * future one. The range is now the single source of truth and the arrows move it, so the
   * control at the top always describes what is below it.
   */
  const period = range.bounded
    ? { from: range.fromDate!, to: range.toDate! }
    : allTimeBounds(entries, today);

  const balance = rangeBalance(entries, period.from, period.to);

  /*
   * The window and the running totals answer different questions, and only one of them is
   * allowed to look forward.
   *
   * Browsing to next month is legitimate — recurring entries are exactly the thing a user
   * wants to see coming. But "year to date" and "recorded cash" are statements about money
   * that has actually moved, and expanding a salary into November to compute them turns a
   * projection into a fact. So the aggregates run through the window's last month *or today*,
   * whichever is earlier, while the list below shows whatever was asked for.
   */
  const viewed = { year: period.to.year, month: period.to.month };
  const thisMonth = { year: today.year, month: today.month };
  const asOf = isAtOrBefore(viewed, thisMonth) ? viewed : thisMonth;
  const lookingAhead = !isAtOrBefore(viewed, thisMonth);

  const ytd = yearBalance(entries, asOf.year, asOf.month);
  const cash = cumulativeCash(entries, asOf);

  // Two source currencies, two rates, and each figure formatted through the one that
  // actually applies to it. Converting a shekel figure at the trading account's rate — or
  // labelling an unconverted shekel figure with a dollar sign — both produce a number that
  // looks entirely reasonable, which is why the two are resolved separately and neither
  // falls back to a bare 1.
  const accountCurrency = account?.accountCurrency ?? 'USD';
  const [cashMoney, tradingMoney] = await Promise.all([
    displayMoney({ source: 'ILS', display: session.user.displayCurrency, locale }),
    displayMoney({ source: accountCurrency, display: session.user.displayCurrency, locale }),
  ]);

  /*
   * Three kinds of number pass through this screen and only one of them needs converting at
   * the point it is printed, so the two formatters are named for what they take rather than
   * for what they produce.
   *
   * `ils` takes a shekel figure — every entry, every total, every category — and converts it
   * on the way out. `inDisplay` takes something already carried into the display currency,
   * which the net-worth legs and the long-position total both are by the time they are summed.
   *
   * They were one formatter before, wrapped around a manual `fromIls` at each call site, which
   * applied the rate twice: `money(fromIls(x))` printed x × rate². Reading in shekels hid it
   * completely, because that rate is 1 — the numbers only went wrong when someone switched to
   * dollars, which is exactly when nobody has a shekel figure in their head to check against.
   */
  const ils = cashMoney.money;
  const inDisplay = (amount: number, options: { signed?: boolean } = {}) =>
    formatMoney(amount, cashMoney.currency, locale, options);

  const fromIls = (amount: number) => (cashMoney.converted ? amount * cashMoney.fx.rate : amount);
  const fromTrading = (amount: number) =>
    tradingMoney.converted ? amount * tradingMoney.fx.rate : amount;

  const tradingValue = account?.equity ?? account?.balance ?? 0;

  // Long positions can be held in several currencies, so each is converted before the
  // portfolio is totalled. If any one of them has no rate, the total is not computed at all
  // rather than blending converted and unconverted legs into a single believable figure.
  const heldCurrencies = [...new Set(positions.map((position) => position.currency))];
  const positionRates = new Map<string, number>();
  let allPositionsConverted = true;
  await Promise.all(
    heldCurrencies.map(async (currency) => {
      const fx = await getFxRate(currency, cashMoney.currency as string);
      if (hasRate(fx)) positionRates.set(currency, fx.rate);
      else allPositionsConverted = false;
    }),
  );

  const longValue = allPositionsConverted
    ? portfolioTotals(
        positions.map((position) => {
          const rate = positionRates.get(position.currency) ?? 1;
          return {
            ...position,
            buyPrice: position.buyPrice * rate,
            currentPrice: position.currentPrice * rate,
            fees: position.fees * rate,
          };
        }),
        new Date(),
      ).value
    : null;

  // Net worth needs all three legs in one currency. Missing any rate makes the sum
  // meaningless, so it is withheld rather than approximated.
  const wealthAvailable =
    cashMoney.converted && tradingMoney.converted && longValue !== null;
  const wealth = wealthAvailable
    ? totalWealth({
        trading: fromTrading(tradingValue),
        longPositions: longValue,
        cash: fromIls(cash),
      })
    : null;

  const categoryLabel = (category: string): string =>
    isKnownCategory(category) ? t(`categories.${category}`) : category;

  // The period, named the way it was chosen: a month by its name, a range by its bounds.
  const periodName = describeRange(range, locale) ?? t('allTime');

  /*
   * The month the arrows step from — set only when the window is exactly one calendar month,
   * whether that came from a preset, a custom range or an arrow.
   */
  const viewedMonth =
    range.months && range.months.from.year === range.months.to.year &&
    range.months.from.month === range.months.to.month
      ? range.months.from
      : null;

  const navButton =
    'border-line bg-raised text-dim hover:text-text flex h-7 w-7 items-center justify-center rounded-lg border';
  const Prev = rtl ? ChevronRight : ChevronLeft;
  const Next = rtl ? ChevronLeft : ChevronRight;

  const byCategory = expensesByCategory(balance);
  const suggestions = (type: 'income' | 'expense') =>
    suggestedCategories(type).map((value) => ({ value, label: t(`categories.${value}`) }));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KPI label={t('income')} value={ils(balance.income)} tone="pos" />
        <KPI label={t('expenses')} value={ils(balance.expenses)} tone="neg" />
        <KPI
          // The unbounded case is *all time*, not a month: `allTimeBounds` runs from the first
          // entry to today. Labelling it "monthly net" described a figure spanning years as one
          // month's flow — and the number beside it, cumulative cash, is a different quantity
          // again. Every real month view is bounded and keeps the range wording.
          label={range.bounded ? t('periodNet') : t('allTimeNet')}
          value={ils(balance.net, { signed: true })}
          tone={balance.net >= 0 ? 'pos' : 'neg'}
          sub={`${lookingAhead ? t('yearToDateAsOfToday') : t('yearToDate')}: ${ils(ytd.net, { signed: true })}`}
        />
        <KPI
          label={t('totalWealth')}
          value={wealth === null ? '—' : inDisplay(wealth)}
          sub={
            wealth === null
              ? t('fxUnavailable')
              : [
                  `${t('trading')} ${tradingMoney.money(tradingValue)}`,
                  longValue && longValue > 0 ? `${t('longPositions')} ${inDisplay(longValue)}` : null,
                  `${t('cash')} ${ils(cash)}`,
                ]
                  .filter(Boolean)
                  .join(' · ')
          }
          title={t('cashNote')}
        />
      </div>

      {cashMoney.stale || tradingMoney.stale ? (
        <p className="text-warn text-xs">{t('fxStale')}</p>
      ) : null}

      <Card
        title={
          <span className="flex items-center gap-2">
            {t('title')} · {periodName}
          </span>
        }
        action={
          /*
           * Only while the window is a single month, because that is the only case where
           * "previous" and "next" have one obvious meaning. Across a quarter, or across
           * everything, the window was chosen deliberately and stepping it by a month would
           * be answering a question nobody asked.
           *
           * They submit the same action the picker does rather than linking, so a month
           * reached with an arrow is stored like any other choice and is still selected
           * after a trip to another tab.
           */
          viewedMonth ? (
            <div className="flex gap-1.5">
              <MonthStep
                month={stepMonth(viewedMonth, -1)}
                label={t('prevMonth')}
                className={navButton}
              >
                <Prev size={14} aria-hidden />
              </MonthStep>
              <MonthStep
                month={stepMonth(viewedMonth, 1)}
                label={t('nextMonth')}
                className={navButton}
              >
                <Next size={14} aria-hidden />
              </MonthStep>
            </div>
          ) : null
        }
      >
        <div className="border-line border-b pb-3">
          <EntryForm
            labels={{
              label: t('label'),
              amount: t('amount'),
              category: t('category'),
              date: t('date'),
              typeIncome: t('typeIncome'),
              typeExpense: t('typeExpense'),
              recurring: t('recurring'),
              recurringHint: t('recurringHint'),
              add: t('add'),
            }}
            categories={{ income: suggestions('income'), expense: suggestions('expense') }}
            defaultDate={defaultDateFor(period, today)}
            window={{ from: iso(period.from), to: iso(period.to) }}
          />
        </div>

        {balance.entries.length === 0 ? (
          <EmptyState>{t('empty')}</EmptyState>
        ) : (
          <div className="flex flex-col">
            {balance.entries.map((occurrence) => (
              <EntryRow
                key={`${occurrence.id}:${occurrence.occurrenceDate.toISOString()}`}
                // The occurrence's own month, not the window's. "End series" ends it *here*,
                // and a range spanning a quarter would otherwise end a December salary in
                // October.
                month={{
                  year: occurrence.occurrenceDate.getUTCFullYear(),
                  month: occurrence.occurrenceDate.getUTCMonth() + 1,
                }}
                entry={{
                  id: occurrence.id,
                  type: occurrence.type,
                  label: occurrence.label,
                  category: categoryLabel(occurrence.category),
                  amount: ils(occurrence.amountIls),
                  // Stored as UTC midnight: a calendar date, not an instant.
                  date: formatDayMonthAt(occurrence.occurrenceDate, 'UTC'),
                  isRecurring: occurrence.isRecurring,
                  generated: occurrence.generated,
                }}
                labels={{
                  recurringBadge: t('recurringBadge'),
                  delete: t('delete'),
                  deleteConfirm: t('deleteConfirm'),
                  endSeries: t('endSeries'),
                  endSeriesConfirm: t('endSeriesConfirm'),
                  deleteSeriesConfirm: t('deleteSeriesConfirm'),
                }}
              />
            ))}
          </div>
        )}
      </Card>

      {byCategory.length > 0 ? (
        <Card title={t('byCategory')}>
          <div className="flex flex-col gap-2">
            {byCategory.map((category) => {
              const share = balance.expenses > 0 ? (category.total / balance.expenses) * 100 : 0;
              return (
                <div key={category.category} className="flex items-center gap-3">
                  <div className="w-32 shrink-0 truncate text-xs">
                    {categoryLabel(category.category)}
                  </div>
                  <div className="bg-raised h-2 flex-1 overflow-hidden rounded-full">
                    <div className="bg-neg h-full rounded-full" style={{ width: `${share}%` }} />
                  </div>
                  <div className="text-dim w-28 shrink-0 text-end text-xs">
                    <Num>
                      {ils(category.total)} · {formatNumber(share, locale, 0)}%
                    </Num>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

const iso = (parts: DateParts) =>
  `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;


/**
 * Today when today is inside the window, otherwise where the window starts — so adding an
 * entry while looking at March does not silently date it today, and an entry added to a range
 * lands somewhere the user can still see it.
 */
/**
 * The window "maximum" means on this screen.
 *
 * `rangeBalance` walks month by month, so an unbounded window still needs two ends. They are
 * taken from the data rather than from an arbitrary epoch: starting at the first entry keeps
 * a recurring salary from being expanded across decades of months nobody recorded anything in,
 * and ending today keeps "everything" a statement about money that has actually moved.
 */
function allTimeBounds(
  entries: readonly { entryDate: Date }[],
  today: { year: number; month: number; day: number },
): { from: DateParts; to: DateParts } {
  const to = { year: today.year, month: today.month, day: today.day };
  if (entries.length === 0) return { from: { year: today.year, month: today.month, day: 1 }, to };

  let earliest = entries[0]!.entryDate;
  for (const entry of entries) {
    if (entry.entryDate.getTime() < earliest.getTime()) earliest = entry.entryDate;
  }
  const start = wallClock(earliest);
  return { from: { year: start.year, month: start.month, day: 1 }, to };
}

/**
 * One arrow. A form rather than a link because the range lives in a cookie as well as the
 * URL, and only the action writes both — a link would move the page and leave the stored
 * choice behind, so the next tab would snap back.
 */
function MonthStep({
  month,
  label,
  className,
  children,
}: {
  month: { year: number; month: number };
  label: string;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <form action={applyRangeAction}>
      <input type="hidden" name="path" value="/finance" />
      <input type="hidden" name="intent" value="months" />
      <input type="hidden" name="fromMonthYear" value={month.year} />
      <input type="hidden" name="fromMonthMonth" value={month.month} />
      <input type="hidden" name="toMonthYear" value={month.year} />
      <input type="hidden" name="toMonthMonth" value={month.month} />
      <button type="submit" aria-label={label} className={className}>
        {children}
      </button>
    </form>
  );
}

function defaultDateFor(
  period: { from: DateParts; to: DateParts },
  today: { year: number; month: number; day: number },
): string {
  const now = iso({ year: today.year, month: today.month, day: today.day });
  return now >= iso(period.from) && now <= iso(period.to) ? now : iso(period.from);
}
