import { getLocale, getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/card';
import { CurrencyChoice, LanguageChoice, ThemeChoice } from './choices';
import { SignOutButton } from '@/components/shell/sign-out-button';
import { asTheme } from '@/lib/theme';
import { Mt5Card, type ConnectedAccount } from './mt5-card';
import { TwoFactorCard } from './two-factor-card';
import { requireSession } from '@/lib/auth/session';
import { getMt5Account } from '@/lib/db';
import { getTwoFactorState } from '@/lib/db/two-factor';
import type { Locale } from '@/i18n/config';
import { asCurrency, formatMoney } from '@/lib/money/currency';
import { formatDateTimeAt } from '@/lib/time/format';

export default async function SettingsPage() {
  const session = await requireSession();
  const t = await getTranslations('settings');
  const tSync = await getTranslations('sync');
  const tNav = await getTranslations('nav');
  const locale = (await getLocale()) as Locale;
  const tWizard = await getTranslations('settings.wizard');

  const tTwoFactor = await getTranslations('settings.twoFactor');
  const [account, twoFactor] = await Promise.all([
    getMt5Account(session.ctx),
    getTwoFactorState(session.ctx.userId),
  ]);

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
        lastSync: account.lastSyncAt ? formatDateTimeAt(account.lastSyncAt) : null,
        balance: money(account.balance),
        equity: money(account.equity),
      }
    : null;

  return (
    <div className="flex max-w-xl flex-col gap-4">
      {/* "Connected MT5 account" is a lie while the wizard is still asking for the details. */}
      <Card title={connected ? t('mt5') : tWizard('title')}>
        <Mt5Card
          account={connected}
          labels={{
            login: t('login'),
            server: t('server'),
            connect: t('connect'),
            disconnect: t('disconnect'),
            disconnectConfirm: t('disconnectConfirm'),
            investor: t('investor'),
            investorWarning: t('investorWarning'),
            replaceTitle: t('replaceTitle'),
            replaceConfirm: t('replaceConfirm'),
            replaceCancel: t('replaceCancel'),
            lastSync: t('lastSync'),
            balance: t('balance'),
            equity: t('equity'),
            never: tSync('never'),
            wizard: {
              step: tWizard('step'),
              of: tWizard('of'),
              back: tWizard('back'),
              help: tWizard('help'),
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
                placeholder: tWizard('server.placeholder'),
                help: tWizard('server.help'),
              },
              password: {
                title: tWizard('password.title'),
                label: tWizard('password.label'),
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
          }}
        />
      </Card>

      {/*
        Directly under the broker connection, and above the cosmetic settings, because it is
        the only other thing on this page that decides who can reach the book. Language, theme
        and currency change how it looks.
      */}
      <Card title={tTwoFactor('title')}>
        <TwoFactorCard
          enabledAt={twoFactor?.confirmedAt ? formatDateTimeAt(twoFactor.confirmedAt) : null}
          recoveryCodesLeft={twoFactor?.recoveryCodes.length ?? 0}
          labels={{
            offTitle: tTwoFactor('offTitle'),
            offBody: tTwoFactor('offBody'),
            enable: tTwoFactor('enable'),
            password: tTwoFactor('password'),
            scanTitle: tTwoFactor('scanTitle'),
            scanBody: tTwoFactor('scanBody'),
            manualKey: tTwoFactor('manualKey'),
            code: tTwoFactor('code'),
            confirm: tTwoFactor('confirm'),
            cancel: tTwoFactor('cancel'),
            qrAlt: tTwoFactor('qrAlt'),
            onSince: tTwoFactor('onSince', {
              date: twoFactor?.confirmedAt ? formatDateTimeAt(twoFactor.confirmedAt) : '',
            }),
            codesLeft: tTwoFactor('codesLeft', { count: twoFactor?.recoveryCodes.length ?? 0 }),
            codesLow: tTwoFactor('codesLow', { count: twoFactor?.recoveryCodes.length ?? 0 }),
            saveCodesTitle: tTwoFactor('saveCodesTitle'),
            saveCodesBody: tTwoFactor('saveCodesBody'),
            codesSaved: tTwoFactor('codesSaved'),
            regenerate: tTwoFactor('regenerate'),
            regenerateBody: tTwoFactor('regenerateBody'),
            disable: tTwoFactor('disable'),
            disableBody: tTwoFactor('disableBody'),
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

      {/*
        Signing out lives here now rather than in the header. It was a one-tap icon beside
        the sync pill — next to the theme switch, a keystroke away from every screen — and
        the only destructive control in the frame. Behind a door, with its own card and the
        account it will sign out of named, it is where someone goes deliberately.
      */}
      <Card title={tNav('signOut')}>
        <p className="text-dim mb-3 text-xs">{session.user.email}</p>
        <SignOutButton label={tNav('signOut')} withText />
      </Card>
    </div>
  );
}
