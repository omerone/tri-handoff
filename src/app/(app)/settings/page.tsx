import { getLocale, getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/card';
import { SettingRow } from '@/components/ui/setting-row';
import { AutoSyncChoice, CurrencyChoice, LanguageChoice, ThemeChoice } from './choices';
import { SignOutButton } from '@/components/shell/sign-out-button';
import { asTheme } from '@/lib/theme';
import { Mt5Card, type ConnectedAccount } from './mt5-card';
import { TwoFactorCard } from './two-factor-card';
import { requireSession } from '@/lib/auth/session';
import { listMt5Accounts } from '@/lib/db';
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
  const [accounts, twoFactor] = await Promise.all([
    listMt5Accounts(session.ctx),
    getTwoFactorState(session.ctx.userId),
  ]);

  // Balance and equity are in the *account's* currency, which is not necessarily the one the
  // user reads the rest of the app in. Showing them in the account currency is the honest
  // choice here: this card is about the broker connection, and converting would invite the
  // question of which rate and when.
  // Per account, because two accounts can be denominated differently and one shared formatter
  // would render the second one's balance in the first one's currency.
  const money = (value: number | null, currency: string | null): string | null =>
    value === null || !currency
      ? null
      : `${formatMoney(value, asCurrency(currency, 'USD'), locale, { decimals: 2 })}`;

  const connected: ConnectedAccount[] = accounts.map((account) => ({
    id: account.id,
    login: account.login,
    server: account.server,
    label: account.label,
    status: account.status,
    lastSync: account.lastSyncAt ? formatDateTimeAt(account.lastSyncAt) : null,
    balance: money(account.balance, account.accountCurrency),
    equity: money(account.equity, account.accountCurrency),
  }));

  return (
    /*
     * Across the page rather than down it.
     *
     * Seven cards in one `max-w-xl` column meant most of a desktop screen was empty on the
     * right while the settings ran off the bottom — the broker connection and the second
     * factor are both tall, and the four preferences underneath are a control and a sentence
     * each. Nothing here has to be read in order, which is what makes a column the wrong
     * shape for it: a column is for a sequence, and this is a set.
     *
     * The two that decide who reaches the book stay together at the top and keep their width,
     * because both hold a form. The four that decide how it looks go four across underneath,
     * where a radio group and one line of explanation is all a card needs.
     */
    <div className="flex flex-col gap-3">
      <div className="grid items-start gap-3 lg:grid-cols-2">
        {/* "Connected MT5 account" is a lie while the wizard is still asking for the details. */}
        <Card title={connected.length > 0 ? t('mt5') : tWizard('title')}>
          <Mt5Card
            accounts={connected}
            labels={{
              login: t('login'),
              server: t('server'),
              connect: t('connect'),
              disconnect: t('disconnect'),
            firstAccount: t('firstAccount'),
            secondAccount: t('secondAccount'),
              slotEmpty: t('slotEmpty'),
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
        {/*
          The right column: the second factor and the way out, stacked. Both are about the
          account rather than about how it looks, and together they come closer to the height
          the broker card sets — which is what stops the column beside it being mostly empty.
        */}
        <div className="flex flex-col gap-3">
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
          {/*
          One card, four rows, a hairline between them — not four cards.

          Each of these was its own panel with its own border, title and padding, all the same
          size whatever they held: a two-option toggle got the frame a paragraph of explanation
          got. It read as a scatter of tiles rather than as a list of decisions. What this
          removes is chrome, not explanation — every sentence that was under a control is still
          under it, and two of these choices cost money or change what a number means.
        */}
          <Card title={t('preferences')}>
            <SettingRow label={t('language')}>
              <LanguageChoice current={session.user.locale} />
            </SettingRow>

            <SettingRow label={t('theme')}>
              <ThemeChoice
                current={asTheme(session.user.theme)}
                labels={{ dark: t('themeDark'), light: t('themeLight'), system: t('themeSystem') }}
              />
            </SettingRow>

            <SettingRow label={t('currency')} description={t('fxNote')}>
              <CurrencyChoice current={asCurrency(session.user.displayCurrency)} />
            </SettingRow>

            <SettingRow
              label={t('autoSync')}
              description={
                session.user.autoSyncOnLogin ? t('autoSyncOnNote') : t('autoSyncOffNote')
              }
            >
              <AutoSyncChoice
                current={session.user.autoSyncOnLogin}
                labels={{ on: t('autoSyncOn'), off: t('autoSyncOff') }}
              />
            </SettingRow>
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
      </div>

      {/*
        Auto-sync leads this row rather than sitting beside the broker card: it is a fact about
        the broker connection and about what it costs, but it is still one switch and a
        sentence, which is the same shape as the three beside it.
      */}
    </div>
  );
}
