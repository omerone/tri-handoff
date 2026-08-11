import { getLocale, getTranslations } from 'next-intl/server';
import { AddSheet } from '@/components/ui/add-sheet';
import { Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { DonutChart } from '@/components/charts/donut-chart';
import { Chip, EmptyState, KPI, Num } from '@/components/ui/kpi';
import { requireSession } from '@/lib/auth/session';
import { listLearningEntries } from '@/lib/db';
import { currentBrother } from '@/lib/preferences/brother';
import { LOCALE_DIR, type Locale } from '@/i18n/config';
import {
  hoursDecimals,
  learnerKey,
  learningTotals,
  type LearningTopic,
} from '@/lib/learning/types';
import { formatNumber } from '@/lib/money/currency';
import { currentResolvedRange } from '@/lib/preferences/range';
import { TOPIC_COLOR } from '@/lib/review/colors';
import { formatDateAt } from '@/lib/time/format';
import { toTradeFilter } from '@/lib/time/range';
import { deleteLearningEntryAction } from './actions';
import { deleteLearningEntriesAction } from '../bulk-delete-actions';
import {
  BulkSelect,
  BulkSelectAll,
  BulkSelectRow,
  BulkSelectToggle,
} from '@/components/ui/bulk-select';
import { LearningEntryForm } from './entry-form';

/**
 * The study ledger.
 *
 * A trading journal records what the market did; this records what the trader did about it.
 * It sits beside the finance ledger rather than inside the trade book because nothing here
 * comes from a broker — it is kept entirely by hand, and a sync can never touch it.
 *
 * Hours are the unit rather than sessions. Four ten-minute videos and one long sit-down are
 * five entries either way, but only one of them is an afternoon of work, and the split this
 * screen exists to show would be wrong if it counted them the same.
 */
export default async function LearningPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const session = await requireSession();
  const t = await getTranslations('learning');
  const tBulk = await getTranslations('bulk');
  const locale = (await getLocale()) as Locale;
  const rtl = LOCALE_DIR[locale] === 'rtl';
  const params = await searchParams;

  const range = await currentResolvedRange(params.range);
  const window = toTradeFilter(range);

  const everyone = await listLearningEntries(session.ctx, { from: window.from, to: window.to });

  /*
   * Whose numbers these are: the header switch's position, the same one finance follows.
   *
   * This screen briefly had its own row of tabs for the same choice. Two controls answering
   * "whose data?" is how the budget ends up on one brother while the study ledger silently
   * shows the other — so the tabs went, and the one switch in the header is the answer
   * everywhere it applies.
   *
   * Filtered here rather than in SQL: the window is already loaded for the comparison card,
   * so a second query would fetch a subset of rows this request is holding anyway. Matching
   * runs through `learnerKey`, which folds case and spacing — entries written before the
   * switch existed still land on the right brother.
   */
  const who = await currentBrother();
  const entries =
    who === null
      ? everyone
      : everyone.filter((entry) => learnerKey(entry.learner) === learnerKey(who));

  const totals = learningTotals(entries);
  // The comparison is over the whole window whichever person is selected — it is the thing the
  // selection is made *from*, and recomputing it from the filtered set would leave one row.
  const comparison = learningTotals(everyone);

  const hours = (value: number) => `${formatNumber(value, locale, hoursDecimals(value))}h`;
  const percent = (value: number) => `${formatNumber(value * 100, locale, 0)}%`;

  const slices = totals.byTopic.map((bucket) => ({
    key: bucket.topic,
    label: t(`topics.${bucket.topic}`),
    value: bucket.hours,
    caption: `${hours(bucket.hours)} · ${percent(totals.hours === 0 ? 0 : bucket.hours / totals.hours)}`,
    color: TOPIC_COLOR[bucket.topic],
  }));

  const today = new Date();
  const defaultDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KPI label={t('totalHours')} value={hours(totals.hours)} />
        <KPI label={t('sessions')} value={formatNumber(totals.sessions, locale)} />
        {totals.byTopic.map((bucket) => (
          <KPI
            key={bucket.topic}
            label={t(`topics.${bucket.topic}`)}
            value={hours(bucket.hours)}
            sub={t('sessionsCount', { count: bucket.sessions })}
          />
        ))}
      </div>

      <Card title={t('byTopic')}>
        <DonutChart
          data={slices}
          total={hours(totals.hours)}
          centerLabel={t('totalHours')}
          emptyLabel={t('empty')}
        />
      </Card>

      {/*
        Who put the hours in.

        The account is one login shared by two people, so a single total is the one number that
        cannot answer the question the ledger exists for: eleven hours between them is a good
        month, or it is one person carrying it, and those are different situations. Drawn only
        once somebody has been named — before that it would be a panel with one row reading
        "unattributed", which is a worse way of saying nothing.
      */}
      {who === null && comparison.byLearner.some((row) => row.learner !== null) ? (
        <Card title={t('byLearner')}>
          <ul className="divide-line divide-y">
            {comparison.byLearner.map((row) => (
              <li
                key={row.learner ?? 'unattributed'}
                className="flex items-baseline justify-between gap-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="text-text text-sm font-semibold">
                    {row.learner ?? t('unattributed')}
                  </div>
                  <div className="text-dim mt-0.5 text-[11px]">
                    {row.byTopic
                      .filter((slot) => slot.hours > 0)
                      .map((slot) => `${t(`topics.${slot.topic}`)} ${hours(slot.hours)}`)
                      .join(' · ')}
                  </div>
                </div>
                <div className="shrink-0 text-end">
                  <div className="tri-num text-text text-sm font-bold">{hours(row.hours)}</div>
                  <div className="text-dim text-[11px]">
                    {t('sessions', { count: row.sessions })}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card title={`${t('title')} · ${t('subtitle')}`}>
        <div className="border-line border-b pb-3">
          <AddSheet label={tBulk('addEntry')}>
            <LearningEntryForm
              defaultDate={defaultDate}
              learner={who}
              labels={{
                learner: t('learner'),
                learnerPlaceholder: t('learnerPlaceholder'),
                what: t('what'),
                whatPlaceholder: t('whatPlaceholder'),
                hours: t('hours'),
                topic: t('topic'),
                date: t('date'),
                note: t('note'),
                notePlaceholder: t('notePlaceholder'),
                add: t('add'),
                topics: { psychology: t('topics.psychology'), technical: t('topics.technical') },
              }}
            />
          </AddSheet>
        </div>

        {entries.length === 0 ? (
          <EmptyState>{t('empty')}</EmptyState>
        ) : (
          <BulkSelect
            keys={entries.map((entry) => entry.id)}
            onDelete={deleteLearningEntriesAction}
          >
            {/* The row control that is always drawn, and the only one until it is pressed.
                Beside "select all" so the boxes appear under the button that asked for them. */}
            <div className="border-line flex items-center gap-3 border-b py-2">
              <BulkSelectAll />
              <BulkSelectToggle />
            </div>

            <ul className="divide-line divide-y">
              {entries.map((entry) => (
                <li key={entry.id} className="flex items-start gap-3 py-3">
                  <BulkSelectRow rowKey={entry.id} label={entry.title} className="self-center" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-text text-sm font-semibold">{entry.title}</span>
                      <Chip>{t(`topics.${entry.topic as LearningTopic}`)}</Chip>
                      {/*
                        The name on the row, not only in the summary. A ledger that totals per
                        person but does not say who did any given session cannot be corrected:
                        the one wrongly attributed hour is invisible until the totals look odd,
                        and by then nobody remembers which session it was.
                      */}
                      {entry.learner ? <Chip tone="brand">{entry.learner}</Chip> : null}
                    </div>
                    {entry.note ? (
                      <p className="text-dim mt-1 text-xs leading-relaxed">{entry.note}</p>
                    ) : null}
                    <div className="text-dim mt-1 text-[11px]">
                      <Num>{formatDateAt(entry.learnedOn)}</Num>
                    </div>
                  </div>

                  <span className="tri-num text-text shrink-0 text-sm font-bold">
                    {hours(entry.hours)}
                  </span>

                  {/*
                  A plain form rather than a confirm dialog: one user per tenant, an entry is
                  two fields, and re-adding it is faster than reading a modal.
                */}
                  <form action={deleteLearningEntryAction} className="shrink-0">
                    <input type="hidden" name="id" value={entry.id} />
                    <button
                      type="submit"
                      aria-label={t('delete')}
                      className="text-dim/60 hover:text-neg flex size-7 items-center justify-center rounded-lg"
                    >
                      <Trash2 size={14} aria-hidden />
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </BulkSelect>
        )}
      </Card>

      <p className="text-dim text-[11px]" dir={rtl ? 'rtl' : 'ltr'}>
        {t('subtitle')}
      </p>
    </div>
  );
}
