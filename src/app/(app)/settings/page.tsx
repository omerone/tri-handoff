import { getLocale, getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/card';
import { CurrencyChoice, LanguageChoice } from './choices';
import { Mt5Card, type ConnectedAccount } from './mt5-card';
import { requireSession } from '@/lib/auth/session';
import { getMt5Account } from '@/lib/db';
import type { Locale } from '@/i18n/config';
import { LOCALE_TAG } from '@/i18n/config';
import { asCurrency, formatMoney } from '@/lib/money/currency';

export default async function SettingsPage() {
  const session = await requireSession();
  const t = await getTranslations('settings');
  const tSync = await getTranslations('sync');
  const locale = (await getLocale()) as Locale;

  const account = await getMt5Account(session.ctx);

  // Balance and equity are in the *account's* currency, which is not necessarily the one the
  // user reads the rest of the app in. Showing them in the account currency is the honest
  // choice here: this card is about the broker connection, and converting would invite the
  // question of which rate and when.
  const money = (value: number | null): string | null =>
    value === null || !account?.accountCurrency
      ? null
      : `${formatMoney(value, asCurrency(account.accountCurrency, 'USD'), locale, { decimals: 2 })}`;

  const connected: ConnectedAccount | null = account
    ? {
        login: account.login,
        server: account.server,
        status: account.status,
        lastSync: account.lastSyncAt
          ? new Intl.DateTimeFormat(LOCALE_TAG[locale], {
              dateStyle: 'short',
              timeStyle: 'short',
            }).format(account.lastSyncAt)
          : null,
        balance: money(account.balance),
        equity: money(account.equity),
      }
    : null;

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <Card title={t('mt5')}>
        <Mt5Card
          account={connected}
          labels={{
            login: t('login'),
            server: t('server'),
            investorPassword: t('investorPassword'),
            connect: t('connect'),
            disconnect: t('disconnect'),
            disconnectConfirm: t('disconnectConfirm'),
            investor: t('investor'),
            investorWarning: t('investorWarning'),
            notConnected: t('notConnected'),
            notConnectedHint: t('notConnectedHint'),
            backfillNote: t('backfillNote'),
            lastSync: t('lastSync'),
            balance: t('balance'),
            equity: t('equity'),
            never: tSync('never'),
          }}
        />
      </Card>

      <Card title={t('language')}>
        <LanguageChoice current={session.user.locale} />
      </Card>

      <Card title={t('currency')}>
        <CurrencyChoice current={asCurrency(session.user.displayCurrency)} />
        <p className="text-dim mt-3 text-xs">{t('fxNote')}</p>
      </Card>
    </div>
  );
}
