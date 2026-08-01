import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/card';
import { LoginForm } from './login-form';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string }>;
}) {
  const t = await getTranslations('auth');
  const params = await searchParams;

  return (
    <Card>
      <div className="pt-2 pb-3">
        <h1 className="text-lg font-extrabold">{t('signInTitle')}</h1>
        <p className="text-dim mt-1 text-xs">{t('signInSubtitle')}</p>
      </div>

      <LoginForm
        labels={{
          email: t('email'),
          password: t('password'),
          submit: t('signIn'),
        }}
        initialNotice={params.reset === 'done' ? t('resetDone') : undefined}
      />

      <div className="mt-4 text-center">
        <Link href="/forgot" className="text-dim hover:text-text text-xs">
          {t('forgot')}
        </Link>
      </div>
    </Card>
  );
}
