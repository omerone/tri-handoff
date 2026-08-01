import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/card';
import { CurrencyChoice, LanguageChoice } from './choices';
import { requireSession } from '@/lib/auth/session';
import { asCurrency } from '@/lib/money/currency';

/**
 * P0 settings: language and display currency. The MT5 account card, with its
 * investor-password-only warning, is added in M1.8.
 */
export default async function SettingsPage() {
  const session = await requireSession();
  const t = await getTranslations('settings');

  return (
    <div className="flex max-w-xl flex-col gap-4">
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
