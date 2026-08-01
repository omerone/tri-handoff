'use client';

import { useActionState } from 'react';
import { Field, FormMessage, SubmitButton } from '@/components/ui/form';
import { completeResetAction, type FormState } from '../../actions';

export function ResetForm({
  token,
  minLength,
  labels,
}: {
  token: string;
  minLength: number;
  labels: { password: string; confirm: string; submit: string };
}) {
  const [state, action] = useActionState<FormState, FormData>(completeResetAction, {});

  return (
    <form action={action} className="flex flex-col gap-3">
      <FormMessage error={state.error} notice={state.notice} />
      <input type="hidden" name="token" value={token} />
      <Field
        label={labels.password}
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={minLength}
        required
        autoFocus
        dir="ltr"
      />
      <Field
        label={labels.confirm}
        name="confirm"
        type="password"
        autoComplete="new-password"
        minLength={minLength}
        required
        dir="ltr"
      />
      <SubmitButton>{labels.submit}</SubmitButton>
    </form>
  );
}
