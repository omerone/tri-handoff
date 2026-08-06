'use client';

import { useActionState } from 'react';
import { Field, FormMessage, SubmitButton } from '@/components/ui/form';
import { signInAction, verifyTwoFactorAction, type FormState } from '../actions';

export type LoginLabels = {
  title: string;
  subtitle: string;
  email: string;
  password: string;
  submit: string;
  twoFactorTitle: string;
  twoFactorSubtitle: string;
  twoFactorCode: string;
  twoFactorSubmit: string;
  twoFactorRecoveryHint: string;
};

/**
 * Sign-in, in one or two steps.
 *
 * Two `useActionState` hooks rather than one action that branches, because they are genuinely
 * two submissions to two server actions with two shapes — and because the code step must not
 * carry the password field along with it. Whichever one last produced a state decides what is
 * on screen: `step: 'totp'` means the password was accepted, anything else means it was not,
 * and a failed code step that returns `step: 'password'` puts the form back where it started.
 *
 * Neither step knows who is signing in. The server holds that in a challenge row keyed by an
 * httpOnly cookie, so there is no user id in the markup to read off and nothing in the DOM
 * that says whether the address even exists here.
 */
export function LoginForm({
  labels,
  initialNotice,
  forgot,
}: {
  labels: LoginLabels;
  initialNotice?: string;
  /** The password-reset link. Rendered under the password step only — see the page. */
  forgot: React.ReactNode;
}) {
  const [passwordState, passwordAction] = useActionState<FormState, FormData>(signInAction, {
    notice: initialNotice,
  });
  const [codeState, codeAction] = useActionState<FormState, FormData>(verifyTwoFactorAction, {});

  /*
   * The code step is showing when the password step asked for it and the code step has not
   * since sent us back. `codeState.step` is only ever set on a failure — a success redirects
   * and this component never renders again — so "undefined" here means "the code step has not
   * answered yet", which is exactly when the password step's request still stands.
   */
  const onCodeStep = codeState.step
    ? codeState.step === 'totp'
    : passwordState.step === 'totp';

  if (onCodeStep) {
    return (
      <>
        <div className="pt-2 pb-3">
          <h1 className="text-lg font-extrabold">{labels.twoFactorTitle}</h1>
          <p className="text-dim mt-1 text-xs">{labels.twoFactorSubtitle}</p>
        </div>

        <form action={codeAction} className="flex flex-col gap-3">
          <FormMessage error={codeState.error} />
          <Field
            label={labels.twoFactorCode}
            name="code"
            required
            autoFocus
            dir="ltr"
            /*
              `one-time-code` is what lets iOS and Android offer the code from the notification,
              and `inputMode="numeric"` puts a phone on the number pad. Not `type="number"`:
              a recovery code goes in this same field and is letters, and the spinner arrows a
              number input draws are meaningless on a code.
            */
            autoComplete="one-time-code"
            inputMode="numeric"
            autoCapitalize="off"
            spellCheck={false}
          />
          <SubmitButton>{labels.twoFactorSubmit}</SubmitButton>
        </form>

        <p className="text-dim mt-4 text-center text-xs">{labels.twoFactorRecoveryHint}</p>
      </>
    );
  }

  return (
    <>
      <div className="pt-2 pb-3">
        <h1 className="text-lg font-extrabold">{labels.title}</h1>
        <p className="text-dim mt-1 text-xs">{labels.subtitle}</p>
      </div>

      <form action={passwordAction} className="flex flex-col gap-3">
        <FormMessage
          // A code step that failed its way back to the password form reports here; otherwise
          // this is the password step's own message.
          error={codeState.step === 'password' ? codeState.error : passwordState.error}
          notice={passwordState.notice}
        />
        <Field
          label={labels.email}
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          dir="ltr"
        />
        <Field
          label={labels.password}
          name="password"
          type="password"
          autoComplete="current-password"
          required
          dir="ltr"
        />
        <SubmitButton>{labels.submit}</SubmitButton>
      </form>

      <div className="mt-4 text-center">{forgot}</div>
    </>
  );
}
