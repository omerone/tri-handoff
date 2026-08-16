import { getLocale, getTranslations } from 'next-intl/server';
import { cookies } from 'next/headers';
import type { Locale } from '@/i18n/config';
import { resolveTheme, THEME_COOKIE } from '@/lib/theme';
import { navRoute, stripNav } from '@/lib/nav';
import { currentMember } from '@/lib/preferences/brother';
import { currentRange } from '@/lib/preferences/range';
import { monthNames, selectableYears } from '@/lib/time/range-options';
import type { TenantSession } from '@/lib/tenant/context';
import Link from 'next/link';
import { Settings as SettingsIcon } from 'lucide-react';
import { TriMark } from '@/components/brand/logo';
import { asCurrency } from '@/lib/money/currency';
import { BrotherSwitch } from './brother-switch';
import { CurrencyToggle } from './currency-toggle';
import { ThemeToggle } from './theme-toggle';
import { MainNav, type NavItem } from './main-nav';
import { PointerGlow } from './pointer-glow';
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
  const member = await currentMember(session.tenant.household);

  return (
    <div className="min-h-screen">
      {/*
        The ambient ground, and the light that follows the pointer over it. Both are fixed,
        both are inert — `pointer-events: none` and `aria-hidden` — and both sit at `z-0`
        under the `z-10` wrapper below, which is what keeps them behind the page rather than
        tinting the text on top of it.
      */}
      <div className="tri-ambient" aria-hidden />
      <PointerGlow />

      <div className="relative z-10">
        <header className="border-line bg-header sticky top-0 z-20 border-b backdrop-blur-[8px]">
          {/*
            `flex-wrap`: the switch joined a row that was already full on a phone, and at
            ~400px the brand's tagline was what gave way — "Trade · Risk · Insight" folded to
            three lines and grew the sticky header every screen scrolls under. Wrapping drops
            the whole controls cluster to its own line instead, whole, under the brand.
          */}
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
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
            <div className="flex flex-wrap items-center gap-2">
              {/* Whose money and whose hours the owned screens show. First in the row: it is
                  an answer about identity, and the rest of the row is about state. Drawn only
                  for a household of two or more — a solo tenant has nobody to switch to, and
                  a control with one position is furniture. */}
              {member !== null && session.tenant.household.length > 1 ? (
                <BrotherSwitch
                  household={session.tenant.household}
                  current={member}
                  labels={{
                    title: t('household.title'),
                    shared: t('household.shared'),
                  }}
                />
              ) : null}
              <SyncStatus session={session} lastLoginAt={session.user.lastLoginAt} />
              {/* Beside the theme, because both are "how I want to read this right now"
                  rather than settings — see the note on the component. */}
              <CurrencyToggle
                current={asCurrency(session.user.displayCurrency)}
                label={t('settings.currency')}
                shekelOnly={t('settings.currencyShekelOnly')}
              />
              <ThemeToggle current={theme} />
              <Link
                href={navRoute('settings').href}
                data-tip={t('nav.settings')}
                aria-label={t('nav.settings')}
                className="tri-tap border-line bg-raised text-dim hover:text-text flex items-center rounded-full border px-3 py-1.5 text-xs"
              >
                <SettingsIcon size={13} aria-hidden />
              </Link>
            </div>
          </div>

          {/* Tabs alone on this row. The range picker shared it until it went down to the top
            of the page — at 375px the six tabs and four range buttons did not fit on one line,
            and the header spent a second row on a control that belongs to the screen below
            it rather than to the frame around it. */}
          <div className="mx-auto max-w-6xl px-2 pb-1">
            <MainNav items={items} />
          </div>
        </header>

        {/*
        The range sits at the top of the page rather than in the header.
        
        It was in the sticky bar so it would stay visible, but a filter pinned above six tabs
        competes with them for a row that is already full, and on a narrow screen it pushed the
        tabs into a second line. Here it reads as what it is: the frame for the screen beneath
        it, belonging to that screen.

        Aligned to the inline end, which is the left corner in Hebrew and the right one in
        English — the same corner in both, the one furthest from where reading starts.
        It renders nothing on the screens where a period means nothing; see `isRangedPath`.

        Beside `main` rather than inside it, sharing its width so the two line up. The picker
        is the frame around the screen, not part of it, and the difference is load-bearing:
        its summary spells out the same month names the screen below is titled with, so with
        both under one element "the July card is on the page" cannot be asked of the DOM
        without also matching the picker that says July is selected.
      */}
        <div className="mx-auto mb-3 flex max-w-6xl justify-end px-4 pt-5">
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

        <main className="mx-auto max-w-6xl px-4 pb-5">{children}</main>

        <footer className="text-dim mx-auto max-w-6xl px-4 pb-6 text-[11px]">
          {session.tenant.name} · {session.user.email}
        </footer>
      </div>
    </div>
  );
}
