import type { Metadata, Viewport } from 'next';
import { Heebo, IBM_Plex_Mono } from 'next/font/google';
import { cookies } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { LOCALE_DIR } from '@/i18n/config';
import { resolveLocale } from '@/i18n/request';
import { resolveTheme, THEME_COOKIE } from '@/lib/theme';
import { DISPLAY_STYLE_COOKIE, resolveDisplayStyle } from '@/lib/display-style';
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
  /*
   * The name under the icon, once this is on a Home Screen.
   *
   * Without it iOS labels the tile with `title` — the whole strapline — and then truncates it
   * to roughly nine characters, so what a person actually ends up with is "TRi — Tra…". The
   * install sheet still shows the long one; this is only what survives underneath.
   *
   * `statusBarStyle` is deliberately left alone. On its default, iOS tints the status bar with
   * `themeColor` below, which already answers light and dark separately — pinning it to
   * `black` would be right for the dark theme and wrong for the other one.
   */
  appleWebApp: { capable: true, title: 'TRi' },
};

export const viewport: Viewport = {
  // Each theme's page colour, so the browser chrome on mobile does not stay black behind a
  // light page. Taken from `--tri-bg` in globals.css, because the two had drifted — #0A0B0F
  // against a page that is #0B1017, and #F4F5F8 against #EEF2F6. That is a seam nobody notices
  // in a browser tab and a visible band above the app once it runs on a Home Screen.
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0b1017' },
    { media: '(prefers-color-scheme: light)', color: '#eef2f6' },
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
  const jar = await cookies();
  const theme = resolveTheme(session?.user.theme, jar.get(THEME_COOKIE)?.value);
  // The second half of the same question, on its own axis: theme is light-or-dark, style is
  // which of the three looks. Both are painted here so neither can flash on first render.
  const style = resolveDisplayStyle(
    session?.user.displayStyle,
    jar.get(DISPLAY_STYLE_COOKIE)?.value,
  );

  return (
    <html lang={locale} dir={LOCALE_DIR[locale]} data-theme={theme} data-style={style}>
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
