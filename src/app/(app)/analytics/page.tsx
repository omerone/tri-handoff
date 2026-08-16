import { getLocale, getTranslations } from 'next-intl/server';
import { describeShare, describeSpread, phrase } from '@/lib/charts/describe';
import { Card } from '@/components/ui/card';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
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
import { formatDuration, hoursToMinutes } from '@/lib/time/format';
import { DonutChart } from '@/components/charts/donut-chart';
import { listLearningEntries } from '@/lib/db';
import { currentBrother } from '@/lib/preferences/brother';
import { isKnownTopic, learnerKey, learningTotals } from '@/lib/learning/types';
import { originalTpBreakdown, tpTimingBreakdown } from '@/lib/review/stats';
import { ORIGINAL_TP_COLOR, TIMING_COLOR, topicColor } from '@/lib/review/colors';
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

  const tCharts = await getTranslations('charts');
  /*
   * The sentence that stands in for each drawing. One helper rather than a string per chart:
   * there are six of these on this page and they should not describe themselves six ways.
   */
  const shareSummary = (slices: readonly { label: string; value: number; caption: string }[]) => {
    const seen = describeShare(slices);
    return seen.top === null
      ? tCharts('empty')
      : tCharts('share', { count: seen.count, top: phrase(seen.top) });
  };
  const spreadSummary = (bars: readonly { label: string; net: number; caption: string }[]) => {
    const seen = describeSpread(bars);
    if (seen.top === null) return tCharts('empty');
    if (seen.bottom === null) return tCharts('spreadOne', { top: phrase(seen.top) });
    return tCharts('spread', {
      count: seen.count,
      top: phrase(seen.top),
      bottom: phrase(seen.bottom),
    });
  };

  // Every breakdown, insight and heatmap cell below is computed from this one list, so the
  // range is applied once, here, and the "buckets sum to the total" guarantee survives it.
  const range = await currentResolvedRange((await searchParams).range);
  const window = toTradeFilter(range);
  const [book, learning] = await Promise.all([
    loadBook(session.ctx, window),
    // The study ledger is not part of the book — nothing about it comes from the broker —
    // but it is narrowed by the same window, so the three donuts below all describe the
    // same stretch of time. And unlike the book, it is *personal*: this screen is joint,
    // but the hours belong to one brother, so the donut follows the header switch exactly
    // as the learning screen does. Without the filter the two screens disagreed by the
    // other brother's hours — same window, same donut, two different answers.
    listLearningEntries(session.ctx, { from: window.from, to: window.to }),
  ]);
  const brother = await currentBrother();
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
  /* Built once rather than inline in the markup: the chart and the sentence that describes it
     have to read the same rows, and two copies of a `.map` is how they stop doing that. */
  const loadBars = loads.map((load) => ({
    key: String(load.trades),
    label: t('analytics.tradesPerDay', { count: load.trades }),
    net: load.avgNet,
    caption: `${t('analytics.daysCount', { count: load.days })} · ${formatNumber(load.winRate, locale, 0)}%`,
  }));
  const excursions = computeExcursions(book.trades);
  const months = monthlyReturns(book.trades, book.openingBalance);
  const grid = monthGrid(months);

  const timing = tpTimingBreakdown(book.trades);
  const original = originalTpBreakdown(book.trades);
  const learned = learningTotals(
    learning.filter((entry) => learnerKey(entry.learner) === learnerKey(brother)),
  );

  const sharePct = (value: number) => `${formatNumber(value * 100, locale, 0)}%`;
  // Same shape as the learning screen — see the note there.
  const learningHours = (value: number) => formatDuration(hoursToMinutes(value), locale, { maxUnit: 'hour' });

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
    label: isKnownTopic(bucket.topic) ? t(`learning.topics.${bucket.topic}`) : bucket.topic,
    value: bucket.hours,
    caption: `${learningHours(bucket.hours)} · ${sharePct(learned.hours === 0 ? 0 : bucket.hours / learned.hours)}`,
    color: topicColor(bucket.topic),
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
          {/* Same three cases as the dashboard — see the note there. */}
          <EmptyState>
            {range.bounded
              ? t('range.empty')
              : book.connected
                ? t('dash.emptyConnected')
                : t('dash.empty')}
          </EmptyState>
        </Card>
        <Card title={t('learning.byTopic')}>
          <DonutChart
            data={learningSlices}
            title={t('learning.byTopic')}
            summary={shareSummary(learningSlices)}
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

  const charts: { title: string; data: BreakdownDatum[]; info: string }[] = [
    {
      title: t('analytics.byWeekday'),
      data: toData(byWeekday(book.trades), weekdayLabel),
      info: t('analytics.info.byWeekday'),
    },
    {
      title: t('analytics.bySession'),
      data: toData(bySession(book.trades), (key) => t(`enum.session.${key}`)),
      info: t('analytics.info.bySession'),
    },
    {
      title: t('analytics.byClass'),
      // Classes with no trades would be four empty bars on most books.
      data: toData(
        byAssetClass(book.trades).filter((b) => b.metrics.count > 0),
        (key) => t(`enum.assetClass.${key}`),
      ),
      info: t('analytics.info.byClass'),
    },
    {
      title: t('analytics.byDirection'),
      data: toData(byDirection(book.trades), (key) => t(`enum.direction.${key}`)),
      info: t('analytics.info.byDirection'),
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
  if (hasStrategies)
    charts.push({
      title: t('journal.byStrategy'),
      data: strategyData,
      info: t('analytics.info.byStrategy'),
    });
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

  if (ratingData.length > 0)
    charts.push({
      title: t('analytics.byRating'),
      data: ratingData,
      info: t('analytics.info.byRating'),
    });
  if (moodData.length > 0)
    charts.push({
      title: t('analytics.byMood'),
      data: moodData,
      info: t('analytics.info.byMood'),
    });
  if (hourData.length > 0)
    charts.push({
      title: t('analytics.byHour'),
      data: hourData,
      info: t('analytics.info.byHour'),
    });
  if (symbolData.length > 0) {
    charts.push({
      title:
        symbolsOmitted > 0
          ? `${t('analytics.bySymbol')} · ${t('analytics.symbolsCapped', { shown: shownSymbols.length, total: allSymbols.length })}`
          : t('analytics.bySymbol'),
      data: symbolData,
      info: t('analytics.info.bySymbol'),
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
      <CollapsibleCard
        defaultOpen={false}
        title={t('analytics.insights')}
        info={t('analytics.info.insights')}
      >
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
      </CollapsibleCard>

      {/*
        By-strategy is in this grid rather than in a full-width card of its own below it. A
        book has two or three strategies, so alone on a row it was a pair of bars stretched
        across twelve hundred pixels — the widest, emptiest panel on the page, and the one
        with the least in it. Beside the other breakdowns it is the same size as the questions
        it belongs with, and an odd count simply leaves the last row half full.
      */}
      {/*
        Level rows, and the charts grow into them.

        This was `items-start` for a day, so each card stood at its own height — which stopped
        "by direction", two bars and one caption line, being drawn as tall as "by hour opened"
        with twelve. It did not shorten the page, since a row is as tall as its tallest member
        either way, and it left the bottoms ragged: a wall of panels that no longer lined up.
        Filling is the answer that is both — the row is level, and the shorter card spends the
        difference on a taller plot instead of on blank surface.
      */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {charts.map((chart) => (
          <CollapsibleCard
            defaultOpen={false}
            key={chart.title}
            title={chart.title}
            info={chart.info}
            infoLabel={chart.title}
          >
            <BreakdownChart
              data={chart.data}
              rtl={rtl}
              display={display}
              title={chart.title}
              summary={spreadSummary(chart.data)}
            />
          </CollapsibleCard>
        ))}
      </div>

      {/*
        Three questions about habit rather than about money, which is why they are donuts
        rather than the signed bars above: each is a share of one whole. They sit before the
        heatmap because they answer "am I following my plan", and the heatmap answers "when
        does my plan work" — the first is the one worth reading first.
      */}
      <div className="grid gap-3 lg:grid-cols-3">
        <CollapsibleCard defaultOpen={false} title={t('review.tpTiming')}>
          <DonutChart
            data={timingSlices}
            title={t('review.tpTiming')}
            summary={shareSummary(timingSlices)}
            total={formatNumber(timing.total, locale)}
            centerLabel={t('review.ofTrades', { count: '' }).trim()}
            emptyLabel={t('review.noneReviewed')}
          />
          <p className="text-dim mt-3 text-[11px]">
            {t('review.reviewedOf', { answered: timing.total, total: book.trades.length })}
          </p>
        </CollapsibleCard>

        <CollapsibleCard defaultOpen={false} title={t('review.originalTp')}>
          <DonutChart
            data={originalSlices}
            title={t('review.originalTp')}
            summary={shareSummary(originalSlices)}
            total={formatNumber(original.total, locale)}
            centerLabel={t('review.ofTrades', { count: '' }).trim()}
            emptyLabel={t('review.noneReviewed')}
          />
          <p className="text-dim mt-3 text-[11px]">{t('review.originalTpQuestion')}</p>
        </CollapsibleCard>

        <CollapsibleCard defaultOpen={false} title={t('learning.byTopic')}>
          <DonutChart
            data={learningSlices}
            title={t('learning.byTopic')}
            summary={shareSummary(learningSlices)}
            total={learningHours(learned.hours)}
            centerLabel={t('learning.totalHours')}
            emptyLabel={t('learning.empty')}
          />
          <p className="text-dim mt-3 text-[11px]">
            {t('learning.sessionsCount', { count: learned.sessions })}
          </p>
        </CollapsibleCard>
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
      <CollapsibleCard
        defaultOpen={false}
        title={t('analytics.holdTimes')}
        info={t('analytics.info.holdTimes')}
      >
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
      </CollapsibleCard>

      {/*
        What the book paid to exist. Both columns have been on every trade since the first
        sync and were readable one trade at a time; nothing added them up.
      */}
      <CollapsibleCard
        defaultOpen={false}
        title={t('analytics.costs')}
        info={t('analytics.info.costs')}
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <KPI
            label={t('analytics.costsTotal')}
            info={t('analytics.info.costsTotal')}
            value={money(costs.total)}
            tone={costs.total > 0 ? 'neg' : 'neutral'}
            sub={t('analytics.costsPerTrade', { amount: money(costs.perTrade) })}
          />
          <KPI
            label={t('analytics.costsCommission')}
            info={t('analytics.info.costsCommission')}
            value={money(costs.commission)}
            sub={t('analytics.costsSwap', { amount: money(costs.swap) })}
          />
          <KPI
            label={t('analytics.costsShare')}
            info={t('analytics.info.costsShare')}
            value={
              costs.shareOfGross === null ? '—' : `${formatNumber(costs.shareOfGross, locale, 1)}%`
            }
            sub={t('analytics.costsGross', { amount: money(costs.gross) })}
            title={costs.shareOfGross === null ? t('analytics.costsNoShare') : undefined}
          />
          <KPI
            label={t('analytics.costsTurned')}
            info={t('analytics.info.costsTurned')}
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
      </CollapsibleCard>

      {/*
        Process rather than outcome. Every other figure on this page describes what happened;
        these four describe how it was done, and they are what separates an edge from a run
        of luck.
      */}
      <CollapsibleCard
        defaultOpen={false}
        title={t('analytics.consistency')}
        info={t('analytics.info.consistency')}
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <KPI
            label={t('analytics.riskSpread')}
            info={t('analytics.info.riskSpread')}
            value={risk.variation === null ? '—' : formatNumber(risk.variation, locale, 2)}
            tone={risk.variation === null ? 'neutral' : risk.variation <= 0.25 ? 'pos' : 'neg'}
            sub={t('analytics.riskInBand', {
              percent: formatNumber(risk.withinBand, locale, 0),
            })}
            title={t('analytics.riskSpreadHint')}
          />
          <KPI
            label={t('analytics.riskTypical')}
            info={t('analytics.info.riskTypical')}
            value={risk.covered === 0 ? '—' : money(risk.median)}
            sub={
              risk.covered === 0
                ? t('analytics.riskNoStops')
                : t('analytics.riskRange', { min: money(risk.min), max: money(risk.max) })
            }
          />
          <KPI
            label={t('analytics.topShare')}
            info={t('analytics.info.topShare')}
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
            info={t('analytics.info.underwater')}
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
              info={t('analytics.info.heat')}
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
              info={t('analytics.info.capture')}
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
              info={t('analytics.info.excursionCoverage')}
              value={`${formatNumber(excursions.coveragePercent, locale, 0)}%`}
              sub={t('analytics.excursionCovered', {
                covered: excursions.covered,
                total: excursions.total,
              })}
            />
          </div>
        ) : null}

        {loads.length > 1 && loadBars.length > 0 ? (
          <div className="mt-4">
            <div className="text-dim mb-2 text-[11px] font-semibold">
              {t('analytics.byDayLoad')}
            </div>
            <BreakdownChart
              data={loadBars}
              title={t('analytics.byDayLoad')}
              summary={spreadSummary(loadBars)}
              rtl={rtl}
              display={display}
            />
          </div>
        ) : null}
      </CollapsibleCard>

      {/*
        The one screen that answers "am I getting better". Everything else here describes a
        single selected window; this one puts the windows side by side.
      */}
      {grid.length > 0 ? (
        <CollapsibleCard
          defaultOpen={false}
          title={t('analytics.byPeriod')}
          pad={false}
          info={t('analytics.info.byPeriod')}
        >
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
        </CollapsibleCard>
      ) : null}

      <CollapsibleCard
        defaultOpen={false}
        title={t('analytics.heatmap')}
        info={t('analytics.info.heatmap')}
      >
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
      </CollapsibleCard>
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
