import { getLocale, getTranslations } from 'next-intl/server';
import { cookies } from 'next/headers';
import type { Locale } from '@/i18n/config';
import { resolveTheme, THEME_COOKIE } from '@/lib/theme';
import { enabledNav } from '@/lib/nav';
import { currentRange } from '@/lib/preferences/range';
import { monthNames, selectableYears } from '@/lib/time/range-options';
import type { TenantSession } from '@/lib/tenant/context';
import { LanguageToggle } from './language-toggle';
import { ThemeToggle } from './theme-toggle';
import { MainNav, type NavItem } from './main-nav';
import { RangePicker } from './range-picker';
import { SignOutButton } from './sign-out-button';
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

  const items: NavItem[] = enabledNav().map((item) => ({
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
            <div
              className="tri-num flex h-9 w-9 items-center justify-center rounded-xl text-[15px] font-extrabold text-white"
              style={{
                background: 'linear-gradient(135deg, var(--tri-brand), var(--tri-brand-2))',
              }}
            >
              TRi
            </div>
            <div>
              <div className="text-base leading-none font-extrabold">{t('app.name')}</div>
              {/* Decoration, and at 320px it wraps to two lines and grows the sticky header
                  that every screen then scrolls under. */}
              <div className="text-dim hidden text-[11px] min-[360px]:block">
                {t('app.tagline')}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <SyncStatus session={session} lastLoginAt={session.user.lastLoginAt} />
            <ThemeToggle current={theme} />
            <LanguageToggle current={locale} />
            <SignOutButton label={t('nav.signOut')} />
          </div>
        </div>

        <MainNav items={items} />

        {/*
          Inside the sticky header, under the nav: the range is the frame everything below is
          read in, and a filter that scrolls away is a filter the reader stops accounting for.
          It hides itself on the screens where a period means nothing — see `isRangedPath`.
        */}
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
      </header>

      <main className="mx-auto max-w-6xl px-4 py-5">{children}</main>

      <footer className="text-dim mx-auto max-w-6xl px-4 pb-6 text-[11px]">
        {session.tenant.name} · {session.user.email}
      </footer>
    </div>
  );
}
