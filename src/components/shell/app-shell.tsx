import { getLocale, getTranslations } from 'next-intl/server';
import { cookies } from 'next/headers';
import type { Locale } from '@/i18n/config';
import { resolveTheme, THEME_COOKIE } from '@/lib/theme';
import { navRoute, stripNav } from '@/lib/nav';
import { currentRange } from '@/lib/preferences/range';
import { monthNames, selectableYears } from '@/lib/time/range-options';
import type { TenantSession } from '@/lib/tenant/context';
import Link from 'next/link';
import { Settings as SettingsIcon } from 'lucide-react';
import { TriMark } from '@/components/brand/logo';
import { ThemeToggle } from './theme-toggle';
import { MainNav, type NavItem } from './main-nav';
import { RangePicker } from './range-picker';
import { SyncStatus } from './sync-status';

/**
 * The frame from the prototype: sticky blurred header with the TRi mark, the sync pill and
 * the language toggle, a horizontally scrollable nav strip beneath it, then the page.
 */
export async function AppShell({
  session,
  children,
}: {
  session: TenantSession;
  children: React.ReactNode;
}) {
  const t = await getTranslations();
  const locale = (await getLocale()) as Locale;
  // Same resolution the root layout paints with, so the sun/moon never offers to switch to
  // the theme already on screen.
  const theme = resolveTheme(session.user.theme, (await cookies()).get(THEME_COOKIE)?.value);

  const items: NavItem[] = stripNav().map((item) => ({
    key: item.key,
    href: item.href,
    label: t(`nav.${item.label}`),
  }));

  // One instant, handed to the picker rather than read again on the client: `thisMonth`
  // resolved against two different clocks is two different months, and a hydration mismatch.
  const now = new Date();
  const range = await currentRange();

  return (
    <div className="min-h-screen">
      <header className="border-line bg-header sticky top-0 z-20 border-b backdrop-blur-[8px]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <TriMark size={36} />
            <div>
              <div className="text-base leading-none font-extrabold">{t('app.name')}</div>
              {/* Decoration, and at 320px it wraps to two lines and grows the sticky header
                  that every screen then scrolls under. */}
              <div className="text-dim hidden text-[11px] min-[360px]:block">
                {t('app.tagline')}
              </div>
            </div>
          </div>

          {/*
            Settings sits here rather than in the strip below, and signing out and the
            language switch have moved off the header entirely and into the Settings page.
            The header is for what is true right now — is the data synced, is it light or
            dark. Everything you go somewhere to change is behind one door.
          */}
          <div className="flex items-center gap-2">
            <SyncStatus session={session} lastLoginAt={session.user.lastLoginAt} />
            <ThemeToggle current={theme} />
            <Link
              href={navRoute('settings').href}
              title={t('nav.settings')}
              aria-label={t('nav.settings')}
              className="tri-tap border-line bg-raised text-dim hover:text-text flex items-center rounded-full border px-3 py-1.5 text-xs"
            >
              <SettingsIcon size={13} aria-hidden />
            </Link>
          </div>
        </div>

        {/*
          The tabs and the range on one line — tabs where reading starts, dates at the far end.
          The range used to have a strip of its own beneath them, which spent a third row of a
          sticky header on four buttons, on every screen.
          
          One row from the tablet breakpoint up, two below it. At 375px the six tabs and four
          range buttons do not share a line: the tabs scroll, the range does not shrink, and the
          page ends up wider than the screen — which the mobile sweep catches as a sideways
          scroll on every screen at once.

          Still inside the sticky header: the range is the frame everything below is read in,
          and a filter that scrolls away is one the reader stops accounting for. It hides itself
          where a period means nothing — see `isRangedPath`.
        */}
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-2 pb-2 md:flex-row md:flex-wrap md:items-center md:justify-between md:gap-x-4">
          <MainNav items={items} />

          <RangePicker
            fallback={range}
            now={now}
            locale={locale}
            years={selectableYears(now)}
            labels={{
              title: t('range.title'),
              presets: {
                max: t('range.max'),
                thisMonth: t('range.thisMonth'),
                lastMonth: t('range.lastMonth'),
              },
              custom: t('range.custom'),
              byMonths: t('range.byMonths'),
              byDates: t('range.byDates'),
              from: t('range.from'),
              to: t('range.to'),
              apply: t('range.apply'),
              monthNames: monthNames(locale),
            }}
          />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-5">{children}</main>

      <footer className="text-dim mx-auto max-w-6xl px-4 pb-6 text-[11px]">
        {session.tenant.name} · {session.user.email}
      </footer>
    </div>
  );
}
