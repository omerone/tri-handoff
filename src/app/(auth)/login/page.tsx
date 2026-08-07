import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/card';
import { LoginForm } from './login-form';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string; expired?: string }>;
}) {
  const t = await getTranslations('auth');
  const params = await searchParams;

  /*
   * Why they are back here.
   *
   * Being returned to a login screen with no explanation reads as a bug, or worse as somebody
   * else having signed them out — and the honest answer is short and reassuring. Matched
   * exactly rather than passed through: the value arrives in a query string, which is to say
   * from whoever sent the link.
   */
  const notice =
    params.expired === 'absolute'
      ? t('sessionExpiredAbsolute')
      : params.expired === 'idle'
        ? t('sessionExpiredIdle')
        : params.reset === 'done'
          ? t('resetDone')
          : undefined;

  return (
    <Card>
      {/*
        The heading and the "forgot password" link moved inside the form, now that the form has
        two steps. Someone being asked for a code has already proved their password: a heading
        above them reading "Sign in to TRi" describes the step they finished, and a password
        reset link beside them offers a remedy for a problem they do not have. Both are passed
        in from here so the strings stay on the server side of the boundary.
      */}
      <LoginForm
        labels={{
          title: t('signInTitle'),
          subtitle: t('signInSubtitle'),
          email: t('email'),
          password: t('password'),
          submit: t('signIn'),
          twoFactorTitle: t('twoFactorTitle'),
          twoFactorSubtitle: t('twoFactorSubtitle'),
          twoFactorCode: t('twoFactorCode'),
          twoFactorSubmit: t('twoFactorSubmit'),
          twoFactorRecoveryHint: t('twoFactorRecoveryHint'),
        }}
        initialNotice={notice}
        forgot={
          <Link href="/forgot" className="text-dim hover:text-text text-xs">
            {t('forgot')}
          </Link>
        }
      />
    </Card>
  );
}
