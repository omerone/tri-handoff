import { getLocale, getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/card';
import { CurrencyChoice, LanguageChoice, ThemeChoice } from './choices';
import { asTheme } from '@/lib/theme';
import { Mt5Card, type ConnectedAccount } from './mt5-card';
import { requireSession } from '@/lib/auth/session';
import { getMt5Account } from '@/lib/db';
import type { Locale } from '@/i18n/config';
import { asCurrency, formatMoney } from '@/lib/money/currency';
import { formatDateTimeAt } from '@/lib/time/format';

export default async function SettingsPage() {
  const session = await requireSession();
  const t = await getTranslations('settings');
  const tSync = await getTranslations('sync');
  const locale = (await getLocale()) as Locale;
  const tWizard = await getTranslations('settings.wizard');

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
          ? formatDateTimeAt(account.lastSyncAt)
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
            wizard: {
              title: tWizard('title'),
              step: tWizard('step'),
              of: tWizard('of'),
              welcome: {
                title: tWizard('welcome.title'),
                subtitle: tWizard('welcome.subtitle'),
                hint: tWizard('welcome.hint'),
                action: tWizard('welcome.action'),
              },
              login: {
                title: tWizard('login.title'),
                label: tWizard('login.label'),
                hint: tWizard('login.hint'),
                help: tWizard('login.help'),
              },
              server: {
                title: tWizard('server.title'),
                label: tWizard('server.label'),
                hint: tWizard('server.hint'),
                live: tWizard('server.live'),
                demo: tWizard('server.demo'),
              },
              password: {
                title: tWizard('password.title'),
                label: tWizard('password.label'),
                warning: tWizard('password.warning'),
                hint: tWizard('password.hint'),
                help: tWizard('password.help'),
              },
              processing: {
                validating: tWizard('processing.validating'),
                syncing: tWizard('processing.syncing'),
              },
              success: {
                title: tWizard('success.title'),
                subtitle: tWizard('success.subtitle'),
                status: tWizard('success.status'),
                action: tWizard('success.action'),
              },
            },
            connectInvalid: t('connectInvalid'),
            connectRejected: t('connectRejected'),
            connectUnreachable: t('connectUnreachable'),
            connectSyncFailed: t('connectSyncFailed'),
            connected: t('connected'),
            tooSoon: t('tooSoon'),
          }}
        />
      </Card>

      <Card title={t('language')}>
        <LanguageChoice current={session.user.locale} />
      </Card>

      <Card title={t('theme')}>
        <ThemeChoice
          current={asTheme(session.user.theme)}
          labels={{ dark: t('themeDark'), light: t('themeLight'), system: t('themeSystem') }}
        />
      </Card>

      <Card title={t('currency')}>
        <CurrencyChoice current={asCurrency(session.user.displayCurrency)} />
        <p className="text-dim mt-3 text-xs">{t('fxNote')}</p>
      </Card>
    </div>
  );
}
