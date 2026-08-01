import { getLocale, getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/config';
import { enabledNav } from '@/lib/nav';
import type { TenantSession } from '@/lib/tenant/context';
import { LanguageToggle } from './language-toggle';
import { MainNav, type NavItem } from './main-nav';
import { SignOutButton } from './sign-out-button';

/**
 * The frame from the prototype: sticky blurred header with the TRi mark, the sync pill and
 * the language toggle, a horizontally scrollable nav strip beneath it, then the page.
 */
export async function AppShell({
  session,
  children,
  headerSlot,
}: {
  session: TenantSession;
  children: React.ReactNode;
  /** The sync pill lands here in M1.2; the shell itself stays free of MT5 concerns. */
  headerSlot?: React.ReactNode;
}) {
  const t = await getTranslations();
  const locale = (await getLocale()) as Locale;

  const items: NavItem[] = enabledNav().map((item) => ({
    key: item.key,
    href: item.href,
    label: t(`nav.${item.label}`),
  }));

  return (
    <div className="min-h-screen">
      <header className="border-line sticky top-0 z-20 border-b bg-[rgba(10,11,15,0.9)] backdrop-blur-[8px]">
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
              <div className="text-dim text-[11px]">{t('app.tagline')}</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {headerSlot}
            <LanguageToggle current={locale} />
            <SignOutButton label={t('nav.signOut')} />
          </div>
        </div>

        <MainNav items={items} />
      </header>

      <main className="mx-auto max-w-6xl px-4 py-5">{children}</main>

      <footer className="text-dim mx-auto max-w-6xl px-4 pb-6 text-[11px]">
        {session.tenant.name} · {session.user.email}
      </footer>
    </div>
  );
}
