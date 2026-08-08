'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ShieldAlert } from 'lucide-react';
import { expireSessionAction } from '@/app/actions/auth';
import { lastActivityAt, watchActivity } from './activity';

/**
 * Says out loud what the database is about to do anyway.
 *
 * A session ends after an hour without use, and twelve hours after it began whatever happens
 * — both enforced in `findSession`, which is the only copy that decides anything. Without
 * this component the enforcement is invisible: a tab left open overnight still shows a
 * signed-in page full of somebody's positions, and only turns into a login screen when
 * somebody finally clicks something. That is the wrong way round. The screen should stop
 * showing the book at the moment the book stops being theirs to show.
 *
 * So this runs the same two clocks in the browser, warns a minute before, and then ends the
 * session for real — through a server action, so the row goes and the event is recorded,
 * rather than by clearing something locally and hoping.
 *
 * **It is a courtesy, not the control.** Someone who disables JavaScript, edits
 * `localStorage`, or leaves a tab in a suspended process gets exactly nothing out of it, and
 * that is fine: their next request finds no session and lands on the login page. Nothing here
 * is trusted by the server.
 */

export function SessionExpiry({
  idleMs,
  warnMs,
  endsAt,
}: {
  /** How long without activity ends the session. */
  idleMs: number;
  /** How long before that to say something. */
  warnMs: number;
  /** The absolute cap, as epoch milliseconds — sign-in time plus the maximum session length. */
  endsAt: number;
}) {
  /*
   * Translated here rather than handed down as labels.
   *
   * The countdown needs a formatter, not a string — the number changes every second — and a
   * formatter is a function, which cannot cross from a server component into a client one.
   * Passing one took `/trades` down in production once already; the note on `MultiFilter`
   * records it. The three numbers above are plain data and cross fine.
   */
  const t = useTranslations('auth');
  const router = useRouter();
  const [remaining, setRemaining] = useState<number | null>(null);
  /*
   * The sign-out runs once.
   *
   * A ref rather than state: the tick that crosses zero must not be able to fire a second
   * time before a re-render lands, and every tab in the browser reaching the deadline
   * together should still only produce one navigation each.
   */
  const ending = useRef(false);

  useEffect(() => {
    const stopWatching = watchActivity();

    const tick = () => {
      if (ending.current) return;

      // Whichever runs out first. The idle clock moves with the person; the absolute one does
      // not move at all, which is the point of having it.
      const deadline = Math.min(lastActivityAt() + idleMs, endsAt);
      const left = deadline - Date.now();

      if (left <= 0) {
        ending.current = true;
        setRemaining(0);
        void expireSessionAction(deadline === endsAt ? 'absolute' : 'idle');
        return;
      }

      setRemaining(left <= warnMs ? left : null);
    };

    tick();
    const timer = setInterval(tick, 1_000);
    return () => {
      clearInterval(timer);
      stopWatching();
    };
  }, [idleMs, warnMs, endsAt]);

  if (remaining === null) return null;

  const seconds = Math.max(0, Math.ceil(remaining / 1_000));

  return (
    /*
     * Not a modal. The warning must not be able to swallow the very interaction that would
     * dismiss it — the person is most likely mid-scroll on the page underneath, and that
     * scroll is activity. It sits above the content and out of the way of both navs: the
     * bottom bar on a phone, the top one on a desktop.
     */
    <div
      role="status"
      aria-live="polite"
      className="tri-sheet-up fixed inset-x-3 bottom-20 z-40 mx-auto max-w-sm sm:bottom-6"
    >
      <div className="border-line bg-surface flex items-center gap-3 rounded-[14px] border p-3 shadow-2xl">
        <ShieldAlert size={18} aria-hidden className="text-neg shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-text text-[13px] font-bold">{t('sessionExpiringTitle')}</div>
          <div className="text-dim mt-0.5 text-[11px]">{t('sessionExpiringBody', { seconds })}</div>
        </div>
        <button
          type="button"
          onClick={() => {
            /*
             * The click is already activity — the capture listener above sees it — so the
             * browser's clock is reset before this runs. What this adds is the server's:
             * `router.refresh()` re-renders the route, which reads the session, which pushes
             * the idle window out. Without it the two clocks disagree by however long the
             * warning was on screen, and the next navigation would redirect to the login page
             * seconds after the person said they were still there.
             */
            setRemaining(null);
            router.refresh();
          }}
          className="tri-tap bg-brand shrink-0 rounded-[10px] px-3 py-2 text-xs font-bold text-on-brand"
        >
          {t('sessionStay')}
        </button>
      </div>
    </div>
  );
}
