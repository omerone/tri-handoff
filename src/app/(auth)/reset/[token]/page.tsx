import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/card';
import { MIN_PASSWORD_LENGTH } from '@/lib/crypto/password';
import { ResetForm } from './reset-form';

/**
 * The token is not validated here — only when the form is submitted. Checking it on render
 * would let anyone with a guessed link learn whether it is live without using it up.
 */
export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const t = await getTranslations('auth');
  const { token } = await params;

  return (
    <Card>
      <div className="pt-2 pb-3">
        <h1 className="text-lg font-extrabold">{t('newPasswordTitle')}</h1>
      </div>

      <ResetForm
        token={token}
        minLength={MIN_PASSWORD_LENGTH}
        labels={{
          password: t('newPassword'),
          confirm: t('confirmPassword'),
          submit: t('setPassword'),
        }}
      />

      <div className="mt-4 text-center">
        <Link href="/login" className="text-dim hover:text-text text-xs">
          {t('backToSignIn')}
        </Link>
      </div>
    </Card>
  );
}
