import 'server-only';
import { getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/config';
import { LOCALE_DIR } from '@/i18n/config';
import { env } from '@/lib/env';
import { sendMail } from './mailer';

/** Escapes user-controlled text before it goes into the HTML body. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function resetUrl(domain: string, token: string): string {
  const { APP_PROTOCOL, APP_BASE_DOMAIN } = env();
  // In development the tenant domain has no port; the base domain carries it.
  const port = APP_BASE_DOMAIN.includes(':') ? `:${APP_BASE_DOMAIN.split(':')[1]}` : '';
  return `${APP_PROTOCOL}://${domain}${port}/reset/${token}`;
}

export async function sendPasswordResetEmail(params: {
  to: string;
  locale: Locale;
  domain: string;
  token: string;
  ttlMinutes: number;
}): Promise<void> {
  const t = await getTranslations({ locale: params.locale, namespace: 'auth' });
  const url = resetUrl(params.domain, params.token);
  const dir = LOCALE_DIR[params.locale];

  const intro = t('emailBody', { minutes: params.ttlMinutes });
  const ignore = t('emailIgnore');

  await sendMail({
    to: params.to,
    subject: t('emailSubject'),
    text: `${intro}\n\n${url}\n\n${ignore}`,
    html: `<!doctype html><html dir="${dir}"><body style="font-family:system-ui,sans-serif;background:#0A0B0F;color:#E8EAF0;padding:24px">
<p style="margin:0 0 16px">${escapeHtml(intro)}</p>
<p style="margin:0 0 16px"><a href="${escapeHtml(url)}" style="color:#5B8CFF">${escapeHtml(url)}</a></p>
<p style="margin:0;color:#8A90A3;font-size:13px">${escapeHtml(ignore)}</p>
</body></html>`,
  });
}
