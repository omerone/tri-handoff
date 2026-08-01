'use client';

import { useActionState } from 'react';
import { Field, FormMessage, SubmitButton } from '@/components/ui/form';
import { adminSignInAction, type AdminFormState } from '../actions';

export function AdminLoginForm() {
  const [state, action] = useActionState<AdminFormState, FormData>(adminSignInAction, {});

  return (
    <form action={action} className="flex flex-col gap-3">
      <FormMessage error={state.error} notice={state.notice} />
      <Field label="Email" name="email" type="email" autoComplete="username" required autoFocus />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      <SubmitButton>Sign in</SubmitButton>
    </form>
  );
}
