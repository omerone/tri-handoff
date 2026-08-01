import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/card';
import { ForgotForm } from './forgot-form';

export default async function ForgotPage() {
  const t = await getTranslations('auth');

  return (
    <Card>
      <div className="pt-2 pb-3">
        <h1 className="text-lg font-extrabold">{t('resetTitle')}</h1>
        <p className="text-dim mt-1 text-xs">{t('resetSubtitle')}</p>
      </div>

      <ForgotForm labels={{ email: t('email'), submit: t('resetSend') }} />

      <div className="mt-4 text-center">
        <Link href="/login" className="text-dim hover:text-text text-xs">
          {t('backToSignIn')}
        </Link>
      </div>
    </Card>
  );
}
