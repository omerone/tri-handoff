import { getLocale, getTranslations } from 'next-intl/server';
import { AddSheet } from '@/components/ui/add-sheet';
import { Pencil, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { DonutChart } from '@/components/charts/donut-chart';
import { Chip, EmptyState, KPI, Num } from '@/components/ui/kpi';
import { requireSession } from '@/lib/auth/session';
import { describeShare, phrase } from '@/lib/charts/describe';
import { findLearningEntry, listLearningEntries, listLearningTopics } from '@/lib/db';
import { currentMember } from '@/lib/preferences/brother';
import { LOCALE_DIR, type Locale } from '@/i18n/config';
import { isKnownTopic, learnerKey, learningTotals, topicKey } from '@/lib/learning/types';
import { formatNumber } from '@/lib/money/currency';
import { currentResolvedRange } from '@/lib/preferences/range';
import { topicColor } from '@/lib/review/colors';
import { toIsoDateAt, formatDateAt, formatDuration, hoursToMinutes } from '@/lib/time/format';
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
  searchParams: Promise<{ range?: string; edit?: string }>;
}) {
  const session = await requireSession();
  const t = await getTranslations('learning');
  const tCharts = await getTranslations('charts');
  const tBulk = await getTranslations('bulk');
  const locale = (await getLocale()) as Locale;
  const rtl = LOCALE_DIR[locale] === 'rtl';
  const params = await searchParams;

  const range = await currentResolvedRange(params.range);
  const window = toTradeFilter(range);

  /*
   * Which session is being rewritten, if any — from the URL rather than from client state.
   *
   * It survives a reload, it can be sent to the other brother, the back button leaves the form
   * rather than the screen, and the page stays a server component. A row that does not exist,
   * or belongs to somebody else, simply loads nothing: the form is then the add form, which is
   * what a stale link should land on.
   */
  const editing = params.edit ? await findLearningEntry(session.ctx, params.edit) : null;

  const [everyone, usedTopics] = await Promise.all([
    listLearningEntries(session.ctx, { from: window.from, to: window.to }),
    /*
     * Deliberately not narrowed by the range. The suggestions exist so a topic is chosen
     * rather than re-typed, and a topic used last year is exactly the one somebody is about to
     * type from memory and spell differently.
     */
    listLearningTopics(session.ctx),
  ]);

  /*
   * Whose numbers these are: the header switch's position, the same one finance follows.
   *
   * This screen briefly had its own row of tabs for the same choice. Two controls answering
   * "whose data?" is how the budget ends up on one brother while the study ledger silently
   * shows the other — so the tabs went, and the one switch in the header is the answer
   * everywhere it applies.
   *
   * Filtered in memory rather than in SQL: the whole window is one query either way, and the
   * matching runs through `learnerKey`, which folds case and spacing — entries written before
   * the switch existed still land on the right brother.
   */
  const who = await currentMember(session.tenant.household);
  // `learnerKey(null)` is the empty string, so a household of one — where `who` is null and
  // every session was stored without a learner — matches exactly its own rows, and a member
  // matches exactly theirs. One line, both worlds.
  const entries = everyone.filter((entry) => learnerKey(entry.learner) === learnerKey(who));

  const totals = learningTotals(entries);


  /*
   * Hours and minutes, not a decimal.
   *
   * "1.65h" is a number the reader has to convert before it says anything; "1ש 39דק'" is the
   * answer. The stored column is hours because that is what it has always been — the
   * conversion happens here, at the only place a person sees it.
   */
  const hours = (value: number) => formatDuration(hoursToMinutes(value), locale, { maxUnit: 'hour' });
  const percent = (value: number) => `${formatNumber(value * 100, locale, 0)}%`;

  /*
   * A built-in topic is translated; a topic the trader invented is their own word and is shown
   * exactly as they typed it. Asking the translator for a key that was never in the message
   * files is how a dynamic label throws in production.
   */
  const topicLabel = (topic: string) => (isKnownTopic(topic) ? t(`topics.${topic}`) : topic);

  const slices = totals.byTopic.map((bucket) => ({
    key: bucket.topic,
    label: topicLabel(bucket.topic),
    value: bucket.hours,
    caption: `${hours(bucket.hours)} · ${percent(totals.hours === 0 ? 0 : bucket.hours / totals.hours)}`,
    color: topicColor(bucket.topic),
  }));

  /* What the ring says, for a reader who cannot see it. The legend beside it carries every
     slice already, so this is the glance rather than the detail. */
  const seenTopics = describeShare(slices);
  const topicSummary =
    seenTopics.top === null
      ? tCharts('empty')
      : tCharts('share', { count: seenTopics.count, top: phrase(seenTopics.top) });

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
            label={topicLabel(bucket.topic)}
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
          title={t('byTopic')}
          summary={topicSummary}
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

      <Card title={`${t('title')} · ${t('subtitle')}`}>
        <div className="border-line border-b pb-3">
          <AddSheet label={editing ? t('edit') : tBulk('addEntry')} openOnMount={editing !== null}>
            <LearningEntryForm
              defaultDate={defaultDate}
              learner={who}
              editing={
                editing
                  ? {
                      id: editing.id,
                      topic: topicLabel(editing.topic),
                      title: editing.title,
                      note: editing.note ?? '',
                      // Back into the pair of fields the form holds. Splitting here rather
                      // than in the component keeps the rounding in one place — the same
                      // place the action reverses it.
                      hours: String(Math.floor(editing.hours)),
                      minutes: String(Math.round((editing.hours % 1) * 60)),
                      learnedOn: toIsoDateAt(editing.learnedOn),
                    }
                  : undefined
              }
              labels={{
                learner: t('learner'),
                what: t('what'),
                whatPlaceholder: t('whatPlaceholder'),
                hours: t('hours'),
            minutes: t('minutes'),
                topic: t('topic'),
                date: t('date'),
                note: t('note'),
                notePlaceholder: t('notePlaceholder'),
                add: t('add'),
              save: t('save'),
              cancel: t('cancel'),
                /*
              Built-ins first by their translated labels, then whatever this trader has
              written before — deduplicated on the folded key so a built-in typed by hand does
              not appear twice in the list that exists to stop exactly that.
            */
            topicOptions: [
              t('topics.technical'),
              t('topics.psychology'),
              ...usedTopics.filter(
                (one) =>
                  !isKnownTopic(one) &&
                  topicKey(one) !== topicKey(t('topics.technical')) &&
                  topicKey(one) !== topicKey(t('topics.psychology')),
              ),
            ],
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
                      <Chip>{topicLabel(entry.topic)}</Chip>
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
                      Editing beside deleting, because a mistyped hour used to leave only one way
                      out: delete the row and type the whole session again. The link carries the
                      range with it, so saving comes back to the window it was opened in.

                      A plain anchor, not `<Link>`.

                      `next.config.ts` keeps a visited route in the client router cache for
                      thirty seconds (`staleTimes: { dynamic: 30 }`), which is a measured win
                      for the nav tabs and wrong here: a client-side navigation to the same
                      route with a new `?edit=` is answered from that cache, so the form opens
                      unseeded and the button still reads "Add". Pressing edit within half a
                      minute of loading the page — which is every real press — got the wrong
                      screen. A full navigation always asks the server.
                  */}
                  <a
                    href={`/learning?${new URLSearchParams({
                      ...(params.range ? { range: params.range } : {}),
                      edit: entry.id,
                    })}`}
                    aria-label={t('edit')}
                    className="text-dim/60 hover:text-text flex size-7 shrink-0 items-center justify-center rounded-lg"
                  >
                    <Pencil size={14} aria-hidden />
                  </a>

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
