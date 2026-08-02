import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/card';
import { EmptyState, KPI, Num } from '@/components/ui/kpi';
import { requireSession } from '@/lib/auth/session';
import { getMt5Account, listFinanceEntries } from '@/lib/db';
import { cumulativeCash, expensesByCategory, monthBalance, totalWealth, yearBalance } from '@/lib/finance/balance';
import { isKnownCategory, suggestedCategories } from '@/lib/finance/categories';
import { LOCALE_DIR, LOCALE_TAG, type Locale } from '@/i18n/config';
import { asCurrency, formatMoney, formatNumber } from '@/lib/money/currency';
import { getFxRate, hasRate } from '@/lib/money/fx';
import { ANALYTICS_TIME_ZONE, wallClock } from '@/lib/time/zone';
import { EntryForm } from './entry-form';
import { EntryRow } from './entry-row';

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
  searchParams: Promise<{ m?: string }>;
}) {
  const session = await requireSession();
  const t = await getTranslations('finance');
  const locale = (await getLocale()) as Locale;
  const rtl = LOCALE_DIR[locale] === 'rtl';
  const params = await searchParams;

  const [entries, account] = await Promise.all([
    listFinanceEntries(session.ctx),
    getMt5Account(session.ctx),
  ]);

  const today = wallClock(new Date());
  const { year, month } = parseMonth(params.m) ?? { year: today.year, month: today.month };

  const balance = monthBalance(entries, year, month);
  // Through the month being viewed, not the whole calendar year — recurring entries would
  // otherwise project a salary into months that have not happened yet.
  const ytd = yearBalance(entries, year, month);
  const cash = cumulativeCash(entries, { year, month });

  const display = asCurrency(session.user.displayCurrency);
  const ils = await getFxRate('ILS', display);
  const trading = await getFxRate(account?.accountCurrency ?? 'USD', display);

  // Two rates, two source currencies. Converting a shekel figure at the trading account's
  // rate is the kind of mistake that produces a plausible number, so the conversions are
  // named rather than shared.
  const fromIls = (amount: number) => (hasRate(ils) ? amount * ils.rate : amount);
  const fromTrading = (amount: number) => (hasRate(trading) ? amount * trading.rate : amount);

  const money = (amount: number, options: { signed?: boolean } = {}) =>
    formatMoney(amount, display, locale, options);

  const tradingValue = account?.equity ?? account?.balance ?? 0;
  const wealth = totalWealth({
    trading: fromTrading(tradingValue),
    // P3 fills this in; until then it is honestly zero rather than quietly absent.
    longPositions: 0,
    cash: fromIls(cash),
  });

  const categoryLabel = (category: string): string =>
    isKnownCategory(category) ? t(`categories.${category}`) : category;

  const monthName = new Intl.DateTimeFormat(LOCALE_TAG[locale], {
    month: 'long',
    year: 'numeric',
    timeZone: ANALYTICS_TIME_ZONE,
  }).format(new Date(Date.UTC(year, month - 1, 15)));

  const dayFormat = new Intl.DateTimeFormat(LOCALE_TAG[locale], {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  });

  const step = (delta: number) => {
    const next = month + delta;
    const y = next < 1 ? year - 1 : next > 12 ? year + 1 : year;
    const m = next < 1 ? 12 : next > 12 ? 1 : next;
    return `?m=${y}-${String(m).padStart(2, '0')}`;
  };

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
        <KPI label={t('income')} value={money(fromIls(balance.income))} tone="pos" />
        <KPI label={t('expenses')} value={money(fromIls(balance.expenses))} tone="neg" />
        <KPI
          label={t('monthNet')}
          value={money(fromIls(balance.net), { signed: true })}
          tone={balance.net >= 0 ? 'pos' : 'neg'}
          sub={`${t('yearToDate')}: ${money(fromIls(ytd.net), { signed: true })}`}
        />
        <KPI
          label={t('totalWealth')}
          value={money(wealth)}
          sub={`${t('trading')} ${money(fromTrading(tradingValue))} · ${t('cash')} ${money(fromIls(cash))}`}
          title={t('cashNote')}
        />
      </div>

      <Card
        title={
          <span className="flex items-center gap-2">
            {t('title')} · {monthName}
          </span>
        }
        action={
          <div className="flex gap-1.5">
            <Link href={step(-1)} aria-label={t('prevMonth')} className={navButton}>
              <Prev size={14} aria-hidden />
            </Link>
            <Link href={step(1)} aria-label={t('nextMonth')} className={navButton}>
              <Next size={14} aria-hidden />
            </Link>
          </div>
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
            defaultDate={defaultDateFor(year, month, today)}
          />
        </div>

        {balance.entries.length === 0 ? (
          <EmptyState>{t('empty')}</EmptyState>
        ) : (
          <div className="flex flex-col">
            {balance.entries.map((occurrence) => (
              <EntryRow
                key={`${occurrence.id}:${occurrence.occurrenceDate.toISOString()}`}
                month={{ year, month }}
                entry={{
                  id: occurrence.id,
                  type: occurrence.type,
                  label: occurrence.label,
                  category: categoryLabel(occurrence.category),
                  amount: money(fromIls(occurrence.amountIls)),
                  date: dayFormat.format(occurrence.occurrenceDate),
                  isRecurring: occurrence.isRecurring,
                  generated: occurrence.generated,
                }}
                labels={{
                  recurringBadge: t('recurringBadge'),
                  delete: t('delete'),
                  deleteConfirm: t('deleteConfirm'),
                  endSeries: t('endSeries'),
                  endSeriesConfirm: t('endSeriesConfirm'),
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
                      {money(fromIls(category.total))} · {formatNumber(share, locale, 0)}%
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

/**
 * Today when looking at the current month, otherwise the first of the month being viewed —
 * so adding an entry while browsing March does not silently date it today.
 */
function defaultDateFor(
  year: number,
  month: number,
  today: { year: number; month: number; day: number },
): string {
  const day = year === today.year && month === today.month ? today.day : 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseMonth(value: string | undefined): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value ?? '');
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12 || year < 1970 || year > 2999) return null;
  return { year, month };
}
