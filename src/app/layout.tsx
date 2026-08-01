import type { Metadata, Viewport } from 'next';
import { Heebo, IBM_Plex_Mono } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { LOCALE_DIR } from '@/i18n/config';
import { resolveLocale } from '@/i18n/request';
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
  themeColor: '#0A0B0F',
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await resolveLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} dir={LOCALE_DIR[locale]} data-theme="dark">
      <body className={`${heebo.variable} ${plexMono.variable} min-h-screen bg-bg text-text`}>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
