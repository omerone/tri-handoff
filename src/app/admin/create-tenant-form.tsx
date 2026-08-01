'use client';

import { useActionState } from 'react';
import { Field, FormMessage, SubmitButton } from '@/components/ui/form';
import { createTenantAction, type AdminFormState } from './actions';

export function CreateTenantForm() {
  const [state, action] = useActionState<AdminFormState, FormData>(createTenantAction, {});

  return (
    <form action={action} className="flex flex-col gap-3">
      <FormMessage error={state.error} notice={state.notice} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Client name" name="name" required placeholder="Yossi Cohen" />
        <Field label="Domain" name="domain" required placeholder="yossi.tri.app" />
        <Field label="User email" name="email" type="email" required placeholder="yossi@example.com" />
        <Field
          label="Initial password"
          name="password"
          type="text"
          required
          placeholder="share this once, then have them reset it"
        />
      </div>
      <div>
        <SubmitButton>Create client</SubmitButton>
      </div>
    </form>
  );
}
