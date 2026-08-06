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
  byStrategy,
  byWeekday,
  heatmap,
  UNLABELLED,
  type Bucket,
  type Metrics,
} from '@/lib/analytics';
import { loadBook } from '@/lib/analytics/load';
import { currentResolvedRange } from '@/lib/preferences/range';
import { toTradeFilter } from '@/lib/time/range';
import { LOCALE_DIR, LOCALE_TAG, type Locale } from '@/i18n/config';
import { formatNumber } from '@/lib/money/currency';
import { displayMoney } from '@/lib/money/display';
import {
  byHour,
  byMood,
  byRating,
  bySymbol,
  NO_MOOD,
  SESSIONS,
  UNRATED,
  WEEKDAYS,
} from '@/lib/analytics/dimensions';
import { holdTimes } from '@/lib/analytics/streaks';
import { formatDuration } from '@/lib/time/format';
import { DonutChart } from '@/components/charts/donut-chart';
import { listLearningEntries } from '@/lib/db';
import { hoursDecimals, learningTotals } from '@/lib/learning/types';
import { originalTpBreakdown, tpTimingBreakdown } from '@/lib/review/stats';
import { ORIGINAL_TP_COLOR, TIMING_COLOR, TOPIC_COLOR } from '@/lib/review/colors';
import { computeCosts, costsBySymbol } from '@/lib/analytics/costs';
import { computeExcursions } from '@/lib/analytics/excursions';
import { concentration, dayLoads, riskConsistency, underwater } from '@/lib/analytics/consistency';
import { equityCurve } from '@/lib/analytics/metrics';
import { monthGrid, monthlyReturns } from '@/lib/analytics/periods';
import { KPI } from '@/components/ui/kpi';
import { ReturnsGrid } from './returns-grid';

/**
 * Instruments named in the costs breakdown.
 *
 * Costs concentrate: a handful of symbols account for nearly all of them, and the tail is a
 * long list of single trades that pushes the interesting rows off the screen. Five is enough
 * to see where the money goes.
 */
const COST_SYMBOLS = 5;

/**
 * "Where am I most profitable" — SPEC §3.5, and the reason the product exists beyond a
 * balance sheet.
 */
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const session = await requireSession();
  const t = await getTranslations();
  const locale = (await getLocale()) as Locale;
  const rtl = LOCALE_DIR[locale] === 'rtl';

  // Every breakdown, insight and heatmap cell below is computed from this one list, so the
  // range is applied once, here, and the "buckets sum to the total" guarantee survives it.
  const range = await currentResolvedRange((await searchParams).range);
  const window = toTradeFilter(range);
  const [book, learning] = await Promise.all([
    loadBook(session.ctx, window),
    // The study ledger is not part of the book — nothing about it comes from the broker —
    // but it is narrowed by the same window, so the three donuts below all describe the
    // same stretch of time.
    listLearningEntries(session.ctx, { from: window.from, to: window.to }),
  ]);
  const { money, display } = await displayMoney({
    source: book.accountCurrency,
    display: session.user.displayCurrency,
    locale,
  });

  /*
   * Two of these are shares of the *reviewed* trades and one is a share of the whole book —
   * see the comments in `review/stats.ts`. The captions carry both the count and the share so
   * the legend answers "how many" and "what fraction" without a second glance at the ring.
   */
  const hold = holdTimes(book.trades);
  const ratingBuckets = byRating(book.trades);
  const moodBuckets = byMood(book.trades);

  /*
   * The process figures, all four computed from the same in-memory book as everything else —
   * so "the parts sum to the whole" survives them, and narrowing the range narrows them too.
   *
   * The equity curve is rebuilt here rather than shared with the dashboard, because this page
   * has its own window and `loadBook` is request-cached per filter: the two would be the same
   * object only when both happened to be looking at the same range.
   */
  const costs = computeCosts(book.trades);
  const costsBySymbolBuckets = costsBySymbol(book.trades).slice(0, COST_SYMBOLS);
  const risk = riskConsistency(book.trades);
  const spread = concentration(book.trades);
  const curve = equityCurve(book.trades, book.openingBalance);
  const spell = underwater(curve, book.openingBalance);
  const loads = dayLoads(book.trades);
  const excursions = computeExcursions(book.trades);
  const months = monthlyReturns(book.trades, book.openingBalance);
  const grid = monthGrid(months);

  const timing = tpTimingBreakdown(book.trades);
  const original = originalTpBreakdown(book.trades);
  const learned = learningTotals(learning);

  const sharePct = (value: number) => `${formatNumber(value * 100, locale, 0)}%`;
  const learningHours = (value: number) => `${formatNumber(value, locale, hoursDecimals(value))}h`;

  const timingSlices = timing.slices.map((slice) => ({
    key: slice.key,
    label: t(`review.timings.${slice.key}`),
    value: slice.count,
    caption: `${formatNumber(slice.count, locale)} · ${sharePct(slice.share)}`,
    color: TIMING_COLOR[slice.key],
  }));

  const originalSlices = original.slices.map((slice) => ({
    key: slice.key,
    label: t(`review.answers.${slice.key}`),
    value: slice.count,
    caption: `${formatNumber(slice.count, locale)} · ${sharePct(slice.share)}`,
    color: ORIGINAL_TP_COLOR[slice.key],
  }));

  const learningSlices = learned.byTopic.map((bucket) => ({
    key: bucket.topic,
    label: t(`learning.topics.${bucket.topic}`),
    value: bucket.hours,
    caption: `${learningHours(bucket.hours)} · ${sharePct(learned.hours === 0 ? 0 : bucket.hours / learned.hours)}`,
    color: TOPIC_COLOR[bucket.topic],
  }));

  if (book.trades.length === 0) {
    /*
     * Every trade-derived section below has nothing to draw, but the study ledger is not
     * derived from trades at all — a week spent reading and not trading is a real week, and
     * hiding the hours because the book was empty would be the opposite of the point.
     */
    return (
      <div className="flex flex-col gap-4">
        <Card title={t('nav.analytics')}>
          <EmptyState>{range.bounded ? t('range.empty') : t('dash.empty')}</EmptyState>
        </Card>
        <Card title={t('learning.byTopic')}>
          <DonutChart
            data={learningSlices}
            total={learningHours(learned.hours)}
            centerLabel={t('learning.totalHours')}
            emptyLabel={t('learning.empty')}
          />
          <p className="text-dim mt-3 text-[11px]">
            {t('learning.sessionsCount', { count: learned.sessions })}
          </p>
        </Card>
      </div>
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

  /*
   * Short month names for the returns grid, from Intl rather than from the message files.
   *
   * Twelve names per locale is twenty-four strings that already exist in every browser and
   * every Node build, correctly abbreviated for each language — and `messages.test.ts` would
   * be policing twenty-four keys whose only failure mode is a typo in a month name.
   */
  const monthFormat = new Intl.DateTimeFormat(LOCALE_TAG[locale], {
    month: 'short',
    timeZone: 'UTC',
  });
  const monthNames = Array.from({ length: 12 }, (_, index) =>
    monthFormat.format(new Date(Date.UTC(2026, index, 1))),
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

  /*
   * By strategy — SPEC §3.5's open question, answered.
   *
   * Only rendered once the trader has labelled something: before that the chart is one bar
   * called "no strategy", which is a worse way of saying "you have not started journalling"
   * than simply not being there. The unlabelled bucket stays in the chart when it exists,
   * because a comparison resting on 40 of 300 trades needs to show the other 260.
   */
  /*
   * By the trader's own score, and by the state they were in.
   *
   * Both were being collected from the first release and never left the journal form — the
   * notebook icon in the trades table only knew whether *something* had been written. These
   * are the question the fields were being filled in for: whether a one-star trade is also a
   * losing one, and whether "revenge" costs what it feels like it costs.
   *
   * Each appears only once there is something to compare. A single bar reading "unrated" is a
   * worse way of saying "you have not started scoring these" than an absent chart.
   */
  const ratingData = ratingBuckets.some((bucket) => bucket.key !== UNRATED)
    ? toData(ratingBuckets, (key) =>
        key === UNRATED ? t('analytics.unrated') : t('analytics.ratingStars', { count: key }),
      )
    : [];

  const moodData = moodBuckets.some((bucket) => bucket.key !== NO_MOOD)
    ? toData(moodBuckets, (key) => (key === NO_MOOD ? t('analytics.noMood') : key))
    : [];

  const strategies = byStrategy(book.trades);
  const hasStrategies = strategies.some((bucket) => bucket.key !== UNLABELLED);
  const strategyData = hasStrategies
    ? toData(strategies, (key) => (key === UNLABELLED ? t('journal.unlabelled') : key))
    : [];
  if (hasStrategies) charts.push({ title: t('journal.byStrategy'), data: strategyData });
  /*
   * By hour and by instrument — both computed since the first release, neither ever drawn.
   *
   * Hours come back only for hours that were traded, so a book worked in one session is three
   * bars rather than twenty-four with twenty-one gaps. Instruments are capped: a chart with
   * forty bars is unreadable on a phone and illegible on a desktop, so the largest by absolute
   * P&L are kept and the caption says how many were left out — a silent top-N reads as "this
   * is everything", which it is not.
   */
  const hourData = toData(byHour(book.trades), (key) => `${key}:00`);

  const allSymbols = bySymbol(book.trades);
  const SYMBOL_LIMIT = 12;
  const rankedSymbols = [...allSymbols].sort(
    (a, b) => Math.abs(b.metrics.net) - Math.abs(a.metrics.net),
  );
  const shownSymbols = rankedSymbols.slice(0, SYMBOL_LIMIT);
  const symbolData = toData(shownSymbols, (key) => key);
  const symbolsOmitted = allSymbols.length - shownSymbols.length;

  if (ratingData.length > 0) charts.push({ title: t('analytics.byRating'), data: ratingData });
  if (moodData.length > 0) charts.push({ title: t('analytics.byMood'), data: moodData });
  if (hourData.length > 0) charts.push({ title: t('analytics.byHour'), data: hourData });
  if (symbolData.length > 0) {
    charts.push({
      title:
        symbolsOmitted > 0
          ? `${t('analytics.bySymbol')} · ${t('analytics.symbolsCapped', { shown: shownSymbols.length, total: allSymbols.length })}`
          : t('analytics.bySymbol'),
      data: symbolData,
    });
  }

  const insights = bestConditions(book.trades);
  const cells = heatmap(book.trades);
  const maxAbs = Math.max(1, ...cells.map((cell) => Math.abs(cell.net)));

  const insightLabel = (dimension: string, key: string): string => {
    if (dimension === 'weekday') return weekdayLabel(key);
    if (dimension === 'session') return t(`enum.session.${key}`);
    if (dimension === 'assetClass') return t(`enum.assetClass.${key}`);
    if (dimension === 'direction') return t(`enum.direction.${key}`);
    if (dimension === 'strategy') return key;
    return t(`enum.style.${key}`);
  };

  return (
    <div className="flex flex-col gap-3">
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

      {/*
        By-strategy is in this grid rather than in a full-width card of its own below it. A
        book has two or three strategies, so alone on a row it was a pair of bars stretched
        across twelve hundred pixels — the widest, emptiest panel on the page, and the one
        with the least in it. Beside the other breakdowns it is the same size as the questions
        it belongs with, and an odd count simply leaves the last row half full.
      */}
      {/*
        `items-start`, which is most of the reason this page was as tall as it was. A grid
        stretches every cell to the tallest in its row, so "by direction" — two bars and one
        line of caption — was drawn the same height as "by hour opened", which carries twelve
        lines of them. Half of that card was blank, and the same happened on every row.
        Letting each card be its own height leaves the bottoms ragged, which is what a set of
        differently-sized answers actually looks like.
      */}
      <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
        {charts.map((chart) => (
          <Card key={chart.title} title={chart.title}>
            <BreakdownChart data={chart.data} rtl={rtl} display={display} />
          </Card>
        ))}
      </div>

      {/*
        Three questions about habit rather than about money, which is why they are donuts
        rather than the signed bars above: each is a share of one whole. They sit before the
        heatmap because they answer "am I following my plan", and the heatmap answers "when
        does my plan work" — the first is the one worth reading first.
      */}
      <div className="grid items-start gap-3 lg:grid-cols-3">
        <Card title={t('review.tpTiming')}>
          <DonutChart
            data={timingSlices}
            total={formatNumber(timing.total, locale)}
            centerLabel={t('review.ofTrades', { count: '' }).trim()}
            emptyLabel={t('review.noneReviewed')}
          />
          <p className="text-dim mt-3 text-[11px]">
            {t('review.reviewedOf', { answered: timing.total, total: book.trades.length })}
          </p>
        </Card>

        <Card title={t('review.originalTp')}>
          <DonutChart
            data={originalSlices}
            total={formatNumber(original.total, locale)}
            centerLabel={t('review.ofTrades', { count: '' }).trim()}
            emptyLabel={t('review.noneReviewed')}
          />
          <p className="text-dim mt-3 text-[11px]">{t('review.originalTpQuestion')}</p>
        </Card>

        <Card title={t('learning.byTopic')}>
          <DonutChart
            data={learningSlices}
            total={learningHours(learned.hours)}
            centerLabel={t('learning.totalHours')}
            emptyLabel={t('learning.empty')}
          />
          <p className="text-dim mt-3 text-[11px]">
            {t('learning.sessionsCount', { count: learned.sessions })}
          </p>
        </Card>
      </div>

      {/*
        The asymmetry every other figure on this page hides.
        
        A trader who closes winners in twenty minutes and sits with losers for two days can
        still show a decent win rate and a positive month. It only becomes visible when the
        two durations are put beside each other, which is why this is a comparison rather than
        a KPI tile — the single number that matters is the relationship between them.
      */}
      {/*
        Not paired with the costs card beside it, which was tried. It saved eighty-five pixels
        and left a hundred and eighty of blank column under this one, because `items-start`
        stops a short card stretching but nothing fills the row it leaves behind. A void that
        size reads as something having failed to load.
      */}
      <Card title={t('analytics.holdTimes')}>
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
          <div>
            <div className="text-dim text-[11px] font-semibold">{t('analytics.holdWinners')}</div>
            <div className="tri-num text-pos text-lg font-extrabold">
              {hold.winners === null ? '—' : formatDuration(Math.round(hold.winners), locale)}
            </div>
          </div>
          <div>
            <div className="text-dim text-[11px] font-semibold">{t('analytics.holdLosers')}</div>
            <div className="tri-num text-neg text-lg font-extrabold">
              {hold.losers === null ? '—' : formatDuration(Math.round(hold.losers), locale)}
            </div>
          </div>
          <p className="text-dim min-w-0 flex-1 text-[11px] leading-relaxed">
            {hold.ratio === null
              ? t('analytics.holdNoPair')
              : hold.ratio < 1
                ? t('analytics.holdRatioShort')
                : t('analytics.holdRatioLong')}
          </p>
        </div>
      </Card>

      {/*
        What the book paid to exist. Both columns have been on every trade since the first
        sync and were readable one trade at a time; nothing added them up.
      */}
      <Card title={t('analytics.costs')}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <KPI
            label={t('analytics.costsTotal')}
            value={money(costs.total)}
            tone={costs.total > 0 ? 'neg' : 'neutral'}
            sub={t('analytics.costsPerTrade', { amount: money(costs.perTrade) })}
          />
          <KPI
            label={t('analytics.costsCommission')}
            value={money(costs.commission)}
            sub={t('analytics.costsSwap', { amount: money(costs.swap) })}
          />
          <KPI
            label={t('analytics.costsShare')}
            value={
              costs.shareOfGross === null ? '—' : `${formatNumber(costs.shareOfGross, locale, 1)}%`
            }
            sub={t('analytics.costsGross', { amount: money(costs.gross) })}
            title={costs.shareOfGross === null ? t('analytics.costsNoShare') : undefined}
          />
          <KPI
            label={t('analytics.costsTurned')}
            value={formatNumber(costs.turnedLosing, locale)}
            tone={costs.turnedLosing > 0 ? 'neg' : 'neutral'}
            sub={t('analytics.costsTurnedNote')}
          />
        </div>

        {/*
          The percentage on each row is that instrument's *own* cost-to-gross ratio, not its
          share of the total bill — "GOLD ate a third of what GOLD made" rather than "GOLD is
          a third of what I paid". It is the more useful of the two and the easier to misread,
          so the heading says which it is.
        */}
        {costsBySymbolBuckets.length > 0 ? (
          <>
            <div className="text-dim mt-4 mb-2 text-[11px] font-semibold">
              {t('analytics.costsBySymbol')}
            </div>
            <ul className="flex flex-col gap-1.5">
              {costsBySymbolBuckets.map((bucket) => (
                <li key={bucket.key} className="flex items-baseline justify-between gap-3 text-xs">
                  <span dir="ltr" className="truncate font-bold">
                    {bucket.key}
                  </span>
                  <span className="text-dim shrink-0">
                    <Num>{money(bucket.costs.total)}</Num>
                    {bucket.costs.shareOfGross === null ? null : (
                      <>
                        {' · '}
                        <Num>{formatNumber(bucket.costs.shareOfGross, locale, 0)}%</Num>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Card>

      {/*
        Process rather than outcome. Every other figure on this page describes what happened;
        these four describe how it was done, and they are what separates an edge from a run
        of luck.
      */}
      <Card title={t('analytics.consistency')}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <KPI
            label={t('analytics.riskSpread')}
            value={risk.variation === null ? '—' : formatNumber(risk.variation, locale, 2)}
            tone={risk.variation === null ? 'neutral' : risk.variation <= 0.25 ? 'pos' : 'neg'}
            sub={t('analytics.riskInBand', {
              percent: formatNumber(risk.withinBand, locale, 0),
            })}
            title={t('analytics.riskSpreadHint')}
          />
          <KPI
            label={t('analytics.riskTypical')}
            value={risk.covered === 0 ? '—' : money(risk.median)}
            sub={
              risk.covered === 0
                ? t('analytics.riskNoStops')
                : t('analytics.riskRange', { min: money(risk.min), max: money(risk.max) })
            }
          />
          <KPI
            label={t('analytics.topShare')}
            value={spread.topShare === null ? '—' : `${formatNumber(spread.topShare, locale, 0)}%`}
            tone={spread.restsOnOneTrade ? 'neg' : 'neutral'}
            sub={
              spread.restsOnOneTrade
                ? t('analytics.restsOnOne')
                : t('analytics.withoutBest', {
                    amount: money(spread.netWithoutBest, { signed: true }),
                  })
            }
            title={t('analytics.topShareHint', { count: spread.topCount })}
          />
          <KPI
            label={t('analytics.underwater')}
            value={t('analytics.days', { count: spell.longestDays })}
            tone={spell.ongoing ? 'neg' : 'neutral'}
            sub={spell.ongoing ? t('analytics.underwaterNow') : t('analytics.underwaterPast')}
            title={t('analytics.underwaterHint')}
          />
        </div>

        {/*
          The overtrading question. Almost every discretionary trader has a load beyond which
          the day turns negative, and a per-trade average can never show it — the good trades
          and the bad ones are averaged together.
        */}
        {/*
          MAE and MFE, aggregated. Shown only when the provider actually supplied price
          history: an empty card on a deployment whose broker has no candle endpoint is worse
          than no card. Coverage rides alongside for the same reason RR coverage does — an
          average over three trades must not look like one over three hundred.
        */}
        {excursions.covered > 0 ? (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <KPI
              label={t('analytics.heat')}
              value={
                excursions.winnerHeat === null
                  ? '—'
                  : `${formatNumber(excursions.winnerHeat * 100, locale, 0)}%`
              }
              sub={t('analytics.throughStop', { count: excursions.winnersThroughStop })}
              title={t('analytics.heatHint')}
            />
            <KPI
              label={t('analytics.capture')}
              value={
                excursions.capture === null
                  ? '—'
                  : `${formatNumber(excursions.capture, locale, 0)}%`
              }
              sub={t('analytics.leftOnTable', { amount: money(excursions.leftOnTable) })}
              title={t('analytics.captureHint')}
            />
            <KPI
              label={t('analytics.excursionCoverage')}
              value={`${formatNumber(excursions.coveragePercent, locale, 0)}%`}
              sub={t('analytics.excursionCovered', {
                covered: excursions.covered,
                total: excursions.total,
              })}
            />
          </div>
        ) : null}

        {loads.length > 1 ? (
          <div className="mt-4">
            <div className="text-dim mb-2 text-[11px] font-semibold">
              {t('analytics.byDayLoad')}
            </div>
            <BreakdownChart
              data={loads.map((load) => ({
                key: String(load.trades),
                label: t('analytics.tradesPerDay', { count: load.trades }),
                net: load.avgNet,
                caption: `${t('analytics.daysCount', { count: load.days })} · ${formatNumber(load.winRate, locale, 0)}%`,
              }))}
              rtl={rtl}
              display={display}
            />
          </div>
        ) : null}
      </Card>

      {/*
        The one screen that answers "am I getting better". Everything else here describes a
        single selected window; this one puts the windows side by side.
      */}
      {grid.length > 0 ? (
        <Card title={t('analytics.byPeriod')} pad={false}>
          <div className="px-4 pt-1 pb-4">
            <ReturnsGrid
              grid={grid}
              rtl={rtl}
              money={money}
              formatPercent={(value) => `${value > 0 ? '+' : ''}${formatNumber(value, locale, 1)}%`}
              labels={{
                months: monthNames,
                year: t('analytics.year'),
                total: t('analytics.yearTotal'),
                cellTitle: (period) =>
                  `${t('kpi.tradesCount', { count: period.trades })} · ${formatNumber(period.winRate, locale, 0)}%`,
              }}
            />
            {/*
              Two notes, because the grid has two modes. With a known opening balance the
              percentages are the point and the note explains how they compound; without one
              there are no percentages to explain, and saying so — and why — is more use than
              a paragraph about a column that is not on screen.
            */}
            <p className="text-dim mt-3 text-[11px] leading-relaxed">
              {months.some((month) => month.percent !== null)
                ? t('analytics.byPeriodNote')
                : t('analytics.byPeriodNoBase')}
            </p>
          </div>
        </Card>
      ) : null}

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
        // Intensity scales with magnitude relative to the strongest cell, plus a floor so an
        // empty square still reads as a square rather than a hole in the grid.
        //
        // `color-mix` against the semantic token rather than a hardcoded RGB triple: the
        // light theme darkens its greens and reds for contrast, and a fixed triple would
        // leave the heatmap tinted in the other theme's colours.
        const intensity = (Math.min(Math.abs(cell.net) / maxAbs, 1) * 0.8 + 0.06) * 100;
        const token = cell.net >= 0 ? 'var(--tri-pos)' : 'var(--tri-neg)';
        const background = `color-mix(in srgb, ${token} ${intensity.toFixed(1)}%, transparent)`;

        return (
          <div
            key={cell.session}
            className="rounded-[10px] px-2.5 py-2 text-center"
            style={{ background }}
          >
            <div className="text-on-heat text-xs font-bold">
              <Num>{money(cell.net, { signed: true })}</Num>
            </div>
            <div className="text-on-heat/70 text-[10px]">{tradeCount(cell.count)}</div>
          </div>
        );
      })}
    </>
  );
}
