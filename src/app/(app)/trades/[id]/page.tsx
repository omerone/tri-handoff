import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/card';
import { Chip, KPI, Num } from '@/components/ui/kpi';
import { requireSession } from '@/lib/auth/session';
import { getMt5Account, getTrade, listJournalVocabulary } from '@/lib/db';
import { LOCALE_DIR, type Locale } from '@/i18n/config';
import { formatNumber } from '@/lib/money/currency';
import { displayMoney } from '@/lib/money/display';
import { JournalForm } from '@/components/journal/journal-form';
import { saveTradeJournalAction } from '../journal-actions';
import { formatDateTimeAt, formatDuration } from '@/lib/time/format';
import { explainMissingRr, type MissingRrReason } from '@/lib/mt5/risk';

/**
 * What the dash beside "RR" means, one answer per reason instead of one for all of them.
 *
 * It used to say the trade had no stop loss whatever the cause, on a card that prints the stop
 * loss six rows below it — which is the contradiction the client wrote in about. Each of these
 * says something a trader can act on: move the stop and the R comes back, report the instrument
 * and it gets a contract size, press refresh and a figure that was never stored gets computed.
 *
 * Two lengths, because the tile has room for three words and the explanation needs a sentence.
 * The short one sits under the value; the full one opens from the ⓘ. Four wrapped lines of
 * explanation under a KPI stretches its grid row and takes the three tiles beside it with it.
 *
 * Written out as a switch rather than a lookup keyed by reason, which is what this was. The
 * keys have to appear as string literals: `messages.test.ts` finds translation call sites by
 * scanning for a quoted argument, and it is the only thing standing between a typo here and a
 * runtime error on a production screen. A key assembled from a template literal is invisible
 * to it, so the version of this that read well was the version with no safety net.
 */
function noRrMessages(
  reason: MissingRrReason,
  t: Awaited<ReturnType<typeof getTranslations>>,
): { short: string; full: string } {
  switch (reason) {
    case 'no-stop-loss':
      return { short: t('journal.noRrStopMissingShort'), full: t('journal.noRrStopMissing') };
    case 'stop-beyond-entry':
      return { short: t('journal.noRrStopBeyondShort'), full: t('journal.noRrStopBeyond') };
    case 'zero-distance':
      return { short: t('journal.noRrZeroDistanceShort'), full: t('journal.noRrZeroDistance') };
    case 'no-volume':
      return { short: t('journal.noRrNoVolumeShort'), full: t('journal.noRrNoVolume') };
    case 'unknown-symbol':
      return { short: t('journal.noRrUnknownShort'), full: t('journal.noRrUnknown') };
    case 'unconvertible':
      return { short: t('journal.noRrRateShort'), full: t('journal.noRrRate') };
    case 'stale':
      return { short: t('journal.noRrStaleShort'), full: t('journal.noRrStale') };
  }
}

/**
 * One trade, everything about it, plus the journal (SPEC §1.1 — the "trade report" adopted
 * from tradeReport).
 *
 * A route rather than a modal: a trader working through a week's trades wants to link to
 * one, hit back, and have the browser behave. It also keeps the page server-rendered, so
 * the numbers are formatted in exactly one place.
 */
export default async function TradeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const t = await getTranslations();
  const locale = (await getLocale()) as Locale;
  const rtl = LOCALE_DIR[locale] === 'rtl';
  const { id } = await params;

  const [trade, account, vocabulary] = await Promise.all([
    getTrade(session.ctx, id),
    getMt5Account(session.ctx),
    listJournalVocabulary(session.ctx),
  ]);

  // A trade belonging to another tenant reads as one that does not exist, which is the
  // correct answer: the caller has no business knowing the difference.
  if (!trade || trade.kind !== 'trade') notFound();

  const { money } = await displayMoney({
    source: account?.accountCurrency ?? 'USD',
    display: session.user.displayCurrency,
    locale,
  });

  const price = (value: number | null) =>
    value === null ? '—' : formatNumber(value, locale, priceDecimals(value));

  const heldMinutes =
    trade.closeAt === null
      ? null
      : Math.max(0, Math.round((trade.closeAt.getTime() - trade.openAt.getTime()) / 60_000));

  const Back = rtl ? ChevronRight : ChevronLeft;

  // Only asked when there is a dash to explain, and answered by re-running the same arithmetic
  // the sync ran rather than a second copy of its rules.
  const noRr =
    trade.rr === null
      ? noRrMessages(explainMissingRr(trade, account?.accountCurrency ?? 'USD'), t)
      : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Link
          href="/trades"
          aria-label={t('journal.back')}
          className="border-line bg-raised text-dim hover:text-text flex h-7 w-7 items-center justify-center rounded-lg border"
        >
          <Back size={14} aria-hidden />
        </Link>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-extrabold">{trade.symbol}</h1>
          <span
            className={`inline-flex items-center gap-1 text-xs ${
              trade.direction === 'long' ? 'text-pos' : 'text-neg'
            }`}
          >
            {trade.direction === 'long' ? (
              <ArrowUpRight size={13} aria-hidden />
            ) : (
              <ArrowDownRight size={13} aria-hidden />
            )}
            {t(`enum.direction.${trade.direction}`)}
          </span>
          <Chip>{t(`enum.assetClass.${trade.assetClass}`)}</Chip>
          <Chip tone="dim">{t(`enum.style.${trade.style}`)}</Chip>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KPI
          label={t('table.pnl')}
          value={money(trade.profit, { signed: true })}
          tone={trade.profit >= 0 ? 'pos' : 'neg'}
        />
        <KPI
          label={t('table.rr')}
          value={trade.rr === null ? '—' : `${formatNumber(trade.rr, locale, 2)}R`}
          tone={(trade.rr ?? 0) >= 0 ? 'pos' : 'neg'}
          sub={noRr?.short}
          info={noRr?.full}
          infoLabel={t('table.rr')}
        />
        <KPI label={t('table.risk')} value={trade.risk === null ? '—' : money(trade.risk)} />
        <KPI
          label={t('journal.held')}
          value={heldMinutes === null ? '—' : formatDuration(heldMinutes, locale)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={t('journal.details')}>
          <dl className="grid grid-cols-2 gap-y-2 text-xs">
            <Row label={t('journal.opened')} value={formatDateTimeAt(trade.openAt)} />
            <Row
              label={t('journal.closed')}
              value={trade.closeAt ? formatDateTimeAt(trade.closeAt) : '—'}
            />
            <Row label={t('journal.entry')} value={price(trade.entryPrice)} />
            <Row label={t('journal.exit')} value={price(trade.exitPrice)} />
            <Row label={t('journal.stopLoss')} value={price(trade.stopLoss)} />
            <Row label={t('journal.takeProfit')} value={price(trade.takeProfit)} />
            <Row label={t('journal.volume')} value={formatNumber(trade.volume, locale, 2)} />
            <Row label={t('journal.commission')} value={money(trade.commission, { decimals: 2 })} />
            <Row label={t('journal.swap')} value={money(trade.swap, { decimals: 2 })} />
            {/*
              How far it went either way before it closed. Only shown when there is an answer:
              a dash on every row of every trade in a deployment whose provider has no candle
              endpoint is a column that teaches people to stop reading it.
            */}
            {trade.mae === null ? null : (
              <Row label={t('journal.mae')} value={money(trade.mae, { decimals: 2 })} />
            )}
            {trade.mfe === null ? null : (
              <Row label={t('journal.mfe')} value={money(trade.mfe, { decimals: 2 })} />
            )}
            <Row label={t('journal.ticket')} value={trade.ticket} />
          </dl>
        </Card>

        <Card title={t('journal.title')}>
          <JournalForm
            values={{
              id: trade.id,
              note: trade.note ?? '',
              tags: trade.tags.join(', '),
              rating: trade.rating,
              mood: trade.mood ?? '',
              strategy: trade.strategy ?? '',
            }}
            vocabulary={vocabulary}
            save={saveTradeJournalAction}
            labels={{
              note: t('journal.note'),
              notePlaceholder: t('journal.notePlaceholder'),
              tags: t('journal.tags'),
              tagsHint: t('journal.tagsHint'),
              rating: t('journal.rating'),
              ratingNone: t('journal.ratingNone'),
              mood: t('journal.mood'),
              moodPlaceholder: t('journal.moodPlaceholder'),
              strategy: t('journal.strategy'),
              strategyPlaceholder: t('journal.strategyPlaceholder'),
              save: t('journal.save'),
            }}
          />
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-dim">{label}</dt>
      <dd>
        <Num className="text-xs">{value}</Num>
      </dd>
    </>
  );
}

/** Enough decimals to show a price move, without printing eight for a stock. */
function priceDecimals(value: number): number {
  if (value >= 1_000) return 2;
  if (value >= 10) return 2;
  return 5;
}
