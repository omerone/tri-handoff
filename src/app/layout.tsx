import type { Metadata, Viewport } from 'next';
import { Heebo, IBM_Plex_Mono } from 'next/font/google';
import { cookies } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { LOCALE_DIR } from '@/i18n/config';
import { resolveLocale } from '@/i18n/request';
import { resolveTheme, THEME_COOKIE } from '@/lib/theme';
import { getSession } from '@/lib/auth/session';
import { InfoLayer } from '@/components/ui/info-layer';
import { TooltipLayer } from '@/components/ui/tooltip';
import './globals.css';

// Heebo carries both Hebrew and Latin, so the UI keeps one voice across both locales.
const heebo = Heebo({
  subsets: ['hebrew', 'latin'],
  weight: ['400', '600', '700', '800'],
  variable: '--font-heebo',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'TRi — Trade · Risk · Insight',
  description: 'Trading journal and personal finance dashboard.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  // Matched to each theme's page colour, so the browser chrome on mobile does not stay
  // black behind a light page.
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0A0B0F' },
    { media: '(prefers-color-scheme: light)', color: '#F4F5F8' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await resolveLocale();
  const messages = await getMessages();
  // The saved preference decides, and the cookie covers the visitor who has no session yet.
  // `getSession` is request-cached and both route-group layouts already call it, so reading it
  // here costs nothing beyond the lookup the page was going to make anyway — and it is the
  // only way Settings and the painted page cannot disagree.
  const session = await getSession();
  const theme = resolveTheme(session?.user.theme, (await cookies()).get(THEME_COOKIE)?.value);

  return (
    <html lang={locale} dir={LOCALE_DIR[locale]} data-theme={theme}>
      <body className={`${heebo.variable} ${plexMono.variable} min-h-screen bg-bg text-text`}>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
        {/*
          Here rather than in the app shell, because the admin console and the login screen
          have controls with hints too and neither goes through that shell. One listener for
          the whole document costs nothing and is the only way a hint cannot be forgotten on
          a page that was added later.
        */}
        <TooltipLayer />
        <InfoLayer />
      </body>
    </html>
  );
}
