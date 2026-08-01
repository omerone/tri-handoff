'use client';

import { useActionState } from 'react';
import { Field, FormMessage, SubmitButton } from '@/components/ui/form';
import { signInAction, type FormState } from '../actions';

export function LoginForm({
  labels,
  initialNotice,
}: {
  labels: { email: string; password: string; submit: string };
  initialNotice?: string;
}) {
  const [state, action] = useActionState<FormState, FormData>(signInAction, {
    notice: initialNotice,
  });

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
        autoComplete="current-password"
        required
        dir="ltr"
      />
      <SubmitButton>{labels.submit}</SubmitButton>
    </form>
  );
}
