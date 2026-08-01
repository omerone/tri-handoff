'use client';

import { useActionState } from 'react';
import { Field, FormMessage, SubmitButton } from '@/components/ui/form';
import { requestResetAction, type FormState } from '../actions';

export function ForgotForm({ labels }: { labels: { email: string; submit: string } }) {
  const [state, action] = useActionState<FormState, FormData>(requestResetAction, {});

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
      <SubmitButton>{labels.submit}</SubmitButton>
    </form>
  );
}
