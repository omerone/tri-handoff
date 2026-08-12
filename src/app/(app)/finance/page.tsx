import { ChevronLeft, ChevronRight } from 'lucide-react';
import { AddSheet } from '@/components/ui/add-sheet';
import { getLocale, getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/card';
import { EmptyState, KPI, Num } from '@/components/ui/kpi';
import { requireSession } from '@/lib/auth/session';
import { isAtOrBefore, stepMonth } from '@/lib/finance/bounds';
import { applyRangeAction } from '@/app/actions/range';
import { currentBrother } from '@/lib/preferences/brother';
import { currentResolvedRange } from '@/lib/preferences/range';
import { describeRange } from '@/lib/time/range';
import { listBudgets, listFinanceEntries, listLongPositions, listMt5Accounts } from '@/lib/db';
import { budgetUse, monthsCovered } from '@/lib/finance/budgets';
import { BudgetGauge } from '@/components/charts/budget-gauge';
import { BudgetControls, BudgetForm } from './budget-form';
import { computeMetrics } from '@/lib/analytics';
import { loadBook } from '@/lib/analytics/load';
import { portfolioTotals } from '@/lib/positions/valuation';
import {
  cumulativeCash,
  expensesByCategory,
  rangeBalance,
  totalWealth,
  yearBalance,
} from '@/lib/finance/balance';
import { categoryVocabulary, isKnownCategory } from '@/lib/finance/categories';
import { LOCALE_DIR, type Locale } from '@/i18n/config';
import {
  CURRENCY_SYMBOL,
  SUPPORTED_CURRENCIES,
  formatMoney,
  formatNumber,
  symbolFor,
} from '@/lib/money/currency';
import { displayMoney } from '@/lib/money/display';
import { getFxRate, hasRate } from '@/lib/money/fx';
import { wallClock } from '@/lib/time/zone';
import { EntryForm } from './entry-form';
import { EntryRow } from './entry-row';
import { deleteFinanceEntriesAction } from '../bulk-delete-actions';
import {
  BulkSelect,
  BulkSelectAll,
  BulkSelectRow,
  BulkSelectToggle,
} from '@/components/ui/bulk-select';
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
  const tBulk = await getTranslations('bulk');
  const locale = (await getLocale()) as Locale;
  const rtl = LOCALE_DIR[locale] === 'rtl';
  const params = await searchParams;

  /*
   * The header switch decides whose budget this screen is. The trading legs below are NOT
   * filtered by it — the broker accounts and the long-term book are joint, which is what the
   * dimmed switch on those screens is saying — so the filter stops here, at the money.
   */
  const brother = await currentBrother();

  const [entries, accounts, positions, budgets] = await Promise.all([
    listFinanceEntries(session.ctx, brother),
    // Every connected account, not the first one — see the trading leg below.
    listMt5Accounts(session.ctx),
    listLongPositions(session.ctx),
    // The ceilings belong to whoever the header switch is resting on, like the ledger itself.
    listBudgets(session.ctx, brother),
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
  /*
   * One rate per currency the accounts are actually denominated in.
   *
   * There used to be exactly one, taken from the first account, because there used to be
   * exactly one account. Two accounts can sit at two brokers in two currencies, and adding
   * their equities together without converting each first adds dollars to euros — a number
   * that is wrong by roughly the exchange rate and looks entirely plausible.
   */
  const accountCurrencies = [...new Set(accounts.map((one) => one.accountCurrency ?? 'USD'))];

  /*
   * This screen is read in shekels, whatever the header is set to.
   *
   * The header's currency is for the trading side, where the account really is denominated in
   * dollars and "how much is this in my money" is a live question. The household book is not
   * that: the rent is in shekels, the salary is in shekels, and the person typing ₪50 into the
   * form — the field says so — was then shown −$17 in the list underneath it. One screen where
   * what you write and what you read are different currencies is a screen you cannot check.
   *
   * So the trading leg converts *into* shekels here to be added to the cash, rather than the
   * cash converting out to meet it.
   */
  const READ_IN = 'ILS';
  const [cashMoney, ...tradingMoneys] = await Promise.all([
    displayMoney({ source: 'ILS', display: READ_IN, locale }),
    ...accountCurrencies.map((currency) =>
      displayMoney({ source: currency, display: READ_IN, locale }),
    ),
  ]);
  const tradingByCurrency = new Map(
    accountCurrencies.map((currency, index) => [currency, tradingMoneys[index]!] as const),
  );
  // Every leg has to convert, or the total is withheld — same rule the long positions follow.
  const tradingConverted = tradingMoneys.every((one) => one.converted);
  const tradingStale = tradingMoneys.some((one) => one.stale);

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
  /** A figure in one account's own currency, carried into the display currency. */
  const fromAccount = (amount: number, currency: string) => {
    const rate = tradingByCurrency.get(currency);
    return rate?.converted ? amount * rate.fx.rate : amount;
  };

  /*
   * What the trading account is worth, and why it is not simply `?? 0`.
   *
   * The broker's own equity is the best answer when there is one: it counts open positions and
   * anything the journal never saw. But it is only there once a sync has succeeded, and a
   * connected account that has never synced — a broker refusing the connection, a token that
   * expired, an account added minutes ago — reported zero. Net worth then silently dropped a
   * whole leg and still rendered as a fact: this deployment showed ₪34,004 while the dashboard
   * showed ₪74,127 for the same account, with nothing on screen to say a leg was missing.
   *
   * So the fallback is the book the dashboard already draws its own balance from — deposits
   * plus everything realised — which is the same quantity arrived at from the other side. Zero
   * is kept for the case it is actually true: no account at all.
   *
   * And it is the sum of *every* connected account. This read the first one only, so a trader
   * with two connected accounts had one of them silently missing from their net worth — two
   * accounts holding $300 each showed a trading leg of $300, with nothing on screen to say the
   * other one existed. Each account is converted out of its own currency before they are added.
   *
   * The fallback stays whole-book, because `bookBalance` is a whole-book quantity — deposits
   * plus everything realised, across every account. It is used when *any* account has yet to
   * report, since summing the ones that have would understate the total just as quietly.
   */
  const reportedPerAccount = accounts.map((one) => one.equity ?? one.balance ?? null);
  const everyAccountReported = reportedPerAccount.every((value) => value !== null);

  const tradingValue = // already in the display currency
    accounts.length === 0
      ? 0
      : everyAccountReported
        ? accounts.reduce(
            (sum, one, index) =>
              sum + fromAccount(reportedPerAccount[index]!, one.accountCurrency ?? 'USD'),
            0,
          )
        : fromAccount(
            await bookBalance(session.ctx),
            accounts[0]?.accountCurrency ?? 'USD',
          );

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
  const wealthAvailable = cashMoney.converted && tradingConverted && longValue !== null;
  const wealth = wealthAvailable
    ? totalWealth({
        trading: tradingValue,
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
    range.months &&
    range.months.from.year === range.months.to.year &&
    range.months.from.month === range.months.to.month
      ? range.months.from
      : null;

  const navButton =
    'border-line bg-raised text-dim hover:text-text flex h-7 w-7 items-center justify-center rounded-lg border';
  const Prev = rtl ? ChevronRight : ChevronLeft;
  const Next = rtl ? ChevronLeft : ChevronRight;

  const byCategory = expensesByCategory(balance);

  /*
   * A budget is a monthly figure and this screen can be showing any window, so the ceiling is
   * scaled to the months on screen — otherwise a quarter's spending is compared to one
   * month's allowance and every normal quarter reads as a wild overrun.
   *
   * `max` has no month span at all, so the gauges are simply not drawn for it: there is no
   * honest number to put on a dial that means "all time versus one month".
   */
  const monthsOnScreen = monthsCovered(range.months);

  /*
   * Each dial is read in the currency its ceiling was written in, not in the header's.
   *
   * So the shekel spending has to come the other way — into the budget's currency — and that
   * needs one rate per currency in use. A missing rate drops that budget rather than measuring
   * it at 1:1: a dollar ceiling against unconverted shekels reports a threefold overrun on a
   * month that never happened, and it is indistinguishable from a real one. What was dropped
   * is named below the grid instead.
   */
  const budgetCurrencies = [...new Set(budgets.map((one) => one.currency))];
  const budgetRates = new Map(
    await Promise.all(
      budgetCurrencies.map(
        async (currency) =>
          [currency, await getFxRate('ILS', currency)] as const,
      ),
    ),
  );
  const rateInto = (currency: string) => {
    const fx = budgetRates.get(currency);
    return fx && hasRate(fx) ? fx.rate : null;
  };

  const gauges =
    monthsOnScreen === null ? [] : budgetUse(budgets, byCategory, monthsOnScreen, rateInto);
  const unmeasured =
    monthsOnScreen === null ? [] : budgets.filter((one) => rateInto(one.currency) === null);

  /** A figure in whatever currency its own budget is kept in. */
  const inBudget = (value: number, currency: string) =>
    formatMoney(value, currency, locale, { decimals: 0 });
  /*
   * What the category field offers, on both forms.
   *
   * Drawn from the whole book rather than the window on screen, because a category used in
   * March is still the right suggestion in August, and from the budgets as well — the ones
   * with a ceiling are exactly the ones a person is about to file money into, and they were
   * missing from the list entirely.
   */
  const budgetedCategories = budgets.map((one) => one.category);
  const named = (values: string[]) => values.map((value) => ({ value, label: categoryLabel(value) }));

  /*
   * Spending is filed against a ceiling, so once there are ceilings they are the whole list.
   *
   * Twelve built-ins under the two categories a person actually keeps is a list you scroll
   * past, and every one of them is a way to file money somewhere no dial is watching. Until
   * the first budget exists there is nothing to offer, so the starting list stands in.
   */
  const expenseOptions = named(
    budgetedCategories.length > 0
      ? categoryVocabulary('expense', { budgeted: budgetedCategories })
      : categoryVocabulary('expense', { used: entries, includeSuggested: true }),
  );
  // Income has no ceilings to file against, so it keeps the book and the starting list.
  const incomeOptions = named(
    categoryVocabulary('income', { used: entries, includeSuggested: true }),
  );
  /* Where a category is invented, so this one offers everything there is. */
  const budgetOptions = named(
    categoryVocabulary('expense', {
      budgeted: budgetedCategories,
      used: entries,
      includeSuggested: true,
    }),
  );

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
                  `${t('trading')} ${inDisplay(tradingValue)}`,
                  longValue && longValue > 0
                    ? `${t('longPositions')} ${inDisplay(longValue)}`
                    : null,
                  `${t('cash')} ${ils(cash)}`,
                ]
                  .filter(Boolean)
                  .join(' · ')
          }
          title={t('cashNote')}
        />
      </div>

      {cashMoney.stale || tradingStale ? (
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
          <AddSheet label={tBulk('addEntry')}>
            <EntryForm
              owner={brother}
              ownerLabel={t('ownerLabel')}
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
              categories={{ income: incomeOptions, expense: expenseOptions }}
              defaultDate={defaultDateFor(period, today)}
              window={{ from: iso(period.from), to: iso(period.to) }}
            />
          </AddSheet>
        </div>

        {balance.entries.length === 0 ? (
          <EmptyState>{t('empty')}</EmptyState>
        ) : (
          <BulkSelect
            keys={balance.entries.map(
              (occurrence) => `${occurrence.id}:${occurrence.occurrenceDate.toISOString()}`,
            )}
            onDelete={deleteFinanceEntriesAction}
            /* A recurring row is drawn once per month it falls in, and deleting takes the
               entry rather than the occurrence — so removing October's salary removes every
               month's. "End series" beside it is the other answer, and this says which one
               the trader is about to give. */
            warning={tBulk('recurringWarning')}
          >
            <div className="border-line flex items-center gap-3 border-b py-2">
              <BulkSelectAll />
              <BulkSelectToggle />
            </div>

            {balance.entries.map((occurrence) => (
              <div
                key={`${occurrence.id}:${occurrence.occurrenceDate.toISOString()}`}
                className="flex items-center gap-3"
              >
                <BulkSelectRow
                  rowKey={`${occurrence.id}:${occurrence.occurrenceDate.toISOString()}`}
                  label={occurrence.label}
                />
                <div className="min-w-0 flex-1">
                  <EntryRow
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
                      // The screen is always one brother's, so a chip repeating his name on
                      // every row would be a column of the same word.
                      owner: null,
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
                </div>
              </div>
            ))}
          </BulkSelect>
        )}
      </Card>

      {/*
        Above the category breakdown rather than below it: this is the same money, read as
        "how much is left" instead of "where it went", and the question with a limit attached
        is the one somebody opens this screen to answer.
      */}
      <Card title={t('budgets')}>
        <div className="flex flex-col gap-4">
          {monthsOnScreen === null ? (
            <p className="text-dim text-xs">{t('budgetsNeedPeriod')}</p>
          ) : gauges.length === 0 ? (
            <p className="text-dim text-xs">{t('budgetsEmpty')}</p>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {gauges.map((gauge) => {
                const tone = gauge.over > 0 ? 'over' : gauge.ratio >= 0.8 ? 'close' : 'ok';
                const budget = budgets.find((one) => one.category === gauge.category)!;
                return (
                  <div key={gauge.category} className="flex flex-col items-center gap-1">
                    <BudgetGauge
                      ratio={gauge.ratio}
                      tone={tone}
                      label={categoryLabel(gauge.category)}
                      /* The headline answers the question the tone just raised: still inside,
                         and this is what is left; past it, and this is by how much. */
                      value={
                        gauge.over > 0
                          ? `+${inBudget(gauge.over, gauge.currency)}`
                          : inBudget(gauge.remaining, gauge.currency)
                      }
                      caption={
                        gauge.over > 0
                          ? t('budgetOver')
                          : t('budgetLeftOf', {
                              budget: inBudget(gauge.budget, gauge.currency),
                            })
                      }
                    />
                    <BudgetControls
                      id={budget.id}
                      /* The monthly figure, not the window-scaled one on the dial above it. */
                      monthlyAmount={budget.amount}
                      labels={{
                        spent: t('budgetSpent', {
                          spent: inBudget(gauge.spent, gauge.currency),
                        }),
                        symbol: symbolFor(gauge.currency),
                        edit: t('budgetEditOf', { category: categoryLabel(gauge.category) }),
                        remove: t('budgetRemoveOf', { category: categoryLabel(gauge.category) }),
                        save: t('save'),
                        cancel: t('cancel'),
                        amount: t('budgetAmount'),
                      }}
                    />
                  </div>
                );
              })}
            </div>
          )}

          {/* Named rather than silently missing — see the rate note above. */}
          {unmeasured.length > 0 ? (
            <p className="text-dim text-xs">
              {t('budgetNoRate', {
                categories: unmeasured.map((one) => categoryLabel(one.category)).join(', '),
              })}
            </p>
          ) : null}

          {/*
            Behind a button on a phone, for the same reason the entry form above it is: the
            dials are what this card is for, and a row of fields above them is a row of fields
            you scroll past every time you come to read one.
          */}
          <AddSheet label={t('budgetSet')}>
            <BudgetForm
              owner={brother}
              labels={{
                category: t('category'),
                categoryPlaceholder: t('budgetCategoryPlaceholder'),
                amount: t('budgetAmount'),
                currency: t('budgetCurrency'),
                add: t('budgetAdd'),
                currencies: SUPPORTED_CURRENCIES.map((code) => ({
                  code,
                  label: `${CURRENCY_SYMBOL[code]} ${code}`,
                })),
                defaultCurrency: READ_IN,
                options: budgetOptions.map((one) => one.label),
              }}
            />
          </AddSheet>
        </div>
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

/**
 * The account balance the dashboard shows, arrived at from the book rather than the broker.
 *
 * Deposits plus everything realised — the same expression the dashboard's own balance KPI
 * uses, so the two screens cannot quietly disagree about what one account is worth. Used only
 * as a fallback: when the broker has reported an equity, that is the better number, because it
 * counts open positions the journal has no row for.
 *
 * `loadBook` is request-cached, so asking for it here costs nothing on a page that has
 * already been rendered from the same context.
 */
async function bookBalance(ctx: Parameters<typeof loadBook>[0]): Promise<number> {
  const book = await loadBook(ctx);
  return book.openingBalance + computeMetrics(book.trades).net;
}
