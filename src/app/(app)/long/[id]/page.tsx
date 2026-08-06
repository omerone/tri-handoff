import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/card';
import { Chip, KPI, Num } from '@/components/ui/kpi';
import { requireSession } from '@/lib/auth/session';
import { getLongPosition, listJournalVocabulary } from '@/lib/db';
import { LOCALE_DIR, type Locale } from '@/i18n/config';
import { asCurrency, formatMoney, formatNumber, formatPercent } from '@/lib/money/currency';
import { isStale, valuePosition } from '@/lib/positions/valuation';
import { formatDateAt, formatDuration } from '@/lib/time/format';
import { JournalForm } from '@/components/journal/journal-form';
import { saveLongJournalAction } from '../journal-actions';

export const dynamic = 'force-dynamic';

/**
 * One long-term holding, and the journal on it.
 *
 * The same shape as `/trades/[id]`, and that is the point rather than a coincidence: a trader
 * writing up their week should not have to learn two screens because one position came from
 * the broker and the other was typed in. The figures differ — a holding has no stop, no R and
 * no ticket, and it has a price whose age matters — so the details card is its own; everything
 * around it, down to the back arrow flipping with the reading direction, is the trade page's.
 *
 * Prices are shown in the position's own currency and not converted. The list converts because
 * it sums across a portfolio that can mix them; one holding has nothing to sum against, and a
 * rate applied to a single number only hides what the broker actually reported.
 */
export default async function LongPositionPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const t = await getTranslations();
  const locale = (await getLocale()) as Locale;
  const rtl = LOCALE_DIR[locale] === 'rtl';
  const { id } = await params;

  const [position, vocabulary] = await Promise.all([
    getLongPosition(session.ctx, id),
    listJournalVocabulary(session.ctx),
  ]);

  // A position belonging to another tenant reads as one that does not exist, which is the
  // correct answer: the caller has no business knowing the difference.
  if (!position) notFound();

  const now = new Date();
  const valuation = valuePosition(position, now);
  const currency = asCurrency(position.currency, 'USD');
  const money = (amount: number, options: { signed?: boolean } = {}) =>
    formatMoney(amount, currency, locale, { decimals: 2, ...options });

  const closed = position.closedAt !== null;
  const heldMinutes = Math.max(
    0,
    Math.round(((position.closedAt ?? now).getTime() - position.buyDate.getTime()) / 60_000),
  );

  const Back = rtl ? ChevronRight : ChevronLeft;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Link
          href="/long"
          aria-label={t('journal.back')}
          className="border-line bg-raised text-dim hover:text-text flex h-7 w-7 items-center justify-center rounded-lg border"
        >
          <Back size={14} aria-hidden />
        </Link>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-extrabold">{position.symbol}</h1>
          {/*
            `long.title`, not `nav.long`. The tab is called "Manual entry" because it holds
            two books — hand-entered trades as well as holdings — and this chip is saying
            which of the two this row is, not which tab it lives under.
          */}
          <Chip tone="dim">{t('long.title')}</Chip>
          {closed ? <Chip tone="dim">{t('long.closed')}</Chip> : null}
          {position.priceSource === 'auto' ? <Chip>{t('long.auto')}</Chip> : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {/*
          A closed holding reports what it realised and an open one what it is showing. They
          are different questions and only one of them has an answer at a time, so this is one
          tile that changes rather than two where one is always a dash.
        */}
        <KPI
          label={closed ? t('long.realized') : t('long.unrealized')}
          value={
            closed
              ? money(position.realizedPnl ?? 0, { signed: true })
              : money(valuation.unrealized, { signed: true })
          }
          tone={(closed ? (position.realizedPnl ?? 0) : valuation.unrealized) >= 0 ? 'pos' : 'neg'}
          sub={closed ? undefined : formatPercent(valuation.unrealizedPercent, locale)}
        />
        <KPI label={t('long.value')} value={money(valuation.value)} />
        <KPI label={t('long.cost')} value={money(valuation.cost)} />
        <KPI label={t('journal.held')} value={formatDuration(heldMinutes, locale)} />
      </div>

      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
        <Card title={t('journal.details')}>
          <dl className="grid grid-cols-2 gap-y-2 text-xs">
            <Row label={t('long.buyDate')} value={formatDateAt(position.buyDate)} />
            {closed ? (
              <Row label={t('journal.closed')} value={formatDateAt(position.closedAt!)} />
            ) : null}
            <Row label={t('long.qty')} value={formatNumber(position.qty, locale, 4)} />
            <Row label={t('long.buyPrice')} value={money(position.buyPrice)} />
            <Row label={t('long.currentValue')} value={money(position.currentPrice)} />
            <Row label={t('long.fees')} value={money(position.fees)} />
            <Row label={t('long.currency')} value={position.currency} />
            <Row label={t('long.updated')} value={formatDateAt(position.valueUpdatedAt)} />
          </dl>
          {/*
            The one thing a holding has that a closed trade does not: a price that can be out
            of date. It is worth saying here as well as in the list, because this page is
            where someone reads the number rather than scans it.
          */}
          {!closed && isStale(valuation) ? (
            <p className="text-warn mt-3 text-[11px]">
              {t('long.staleWarning', { days: valuation.priceAgeDays })}
            </p>
          ) : null}
        </Card>

        <Card title={t('journal.title')}>
          <JournalForm
            values={{
              id: position.id,
              note: position.journal.note ?? '',
              tags: position.journal.tags.join(', '),
              rating: position.journal.rating,
              mood: position.journal.mood ?? '',
              strategy: position.journal.strategy ?? '',
            }}
            vocabulary={vocabulary}
            save={saveLongJournalAction}
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
