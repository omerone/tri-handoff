import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/card';
import { SignupForm } from './signup-form';

export default async function SignupPage() {
  const t = await getTranslations('auth');

  return (
    <Card>
      <div className="pt-2 pb-3">
        <h1 className="text-lg font-extrabold">{t('signInTitle')}</h1>
        <p className="text-dim mt-1 text-xs">{t('signInSubtitle')}</p>
      </div>

      <SignupForm
        labels={{
          email: t('email'),
          password: t('password'),
          confirm: t('password'),
          submit: 'הירשם',
        }}
      />

      <div className="mt-4 text-center">
        <Link href="/login" className="text-dim hover:text-text text-xs">
          כבר יש לך חשבון? היכנס
        </Link>
      </div>
    </Card>
  );
}
