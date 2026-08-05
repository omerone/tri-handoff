import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { TenantGate } from '@/components/tenant-gate';
import { TriMark } from '@/components/brand/logo';
import { LanguageToggle } from '@/components/shell/language-toggle';
import type { Locale } from '@/i18n/config';
import { getSession } from '@/lib/auth/session';

/** Tenant-scoped: never prerender. See the note in src/app/(app)/layout.tsx. */
export const dynamic = 'force-dynamic';


/**
 * Sign-in, forgot-password and reset all share this frame. Anyone who already has a valid
 * session is sent straight to the dashboard.
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <TenantGate>
      <AuthFrame>{children}</AuthFrame>
    </TenantGate>
  );
}

async function AuthFrame({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (session) redirect('/dashboard');

  const t = await getTranslations('app');
  const locale = (await getLocale()) as Locale;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-5 py-10">
      {/* Someone who cannot read the default language has to be able to switch before they
          can sign in, so the toggle lives outside the app shell too. */}
      <div className="absolute top-4 end-4">
        <LanguageToggle current={locale} />
      </div>

      <div className="mb-6 flex items-center gap-3">
        <TriMark size={40} />
        <div>
          <div className="text-base leading-none font-extrabold">{t('name')}</div>
          <div className="text-dim text-[11px]">{t('tagline')}</div>
        </div>
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
