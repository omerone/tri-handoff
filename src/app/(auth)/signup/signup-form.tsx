'use client';

import { useActionState } from 'react';
import { Field, FormMessage, SubmitButton } from '@/components/ui/form';
import { signUpAction, type FormState } from '../actions';

export function SignupForm({
  labels,
}: {
  labels: { email: string; password: string; confirm: string; submit: string };
}) {
  const [state, action] = useActionState<FormState, FormData>(signUpAction, {});

  return (
    <form action={action} className="flex flex-col gap-3">
      <FormMessage error={state.error} notice={state.notice} />
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
        autoComplete="new-password"
        required
        dir="ltr"
      />
      <Field
        label={labels.confirm}
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
        dir="ltr"
      />
      <SubmitButton>{labels.submit}</SubmitButton>
    </form>
  );
}
