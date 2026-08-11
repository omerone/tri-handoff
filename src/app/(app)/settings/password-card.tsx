'use client';

import { useActionState, useEffect, useRef } from 'react';
import { Field, FormMessage, SubmitButton } from '@/components/ui/form';
import { changePasswordAction, type PasswordFormState } from './password-actions';

export type PasswordLabels = {
  note: string;
  current: string;
  next: string;
  confirm: string;
  submit: string;
};

/**
 * The trader's own password, changed from inside the account.
 *
 * An account is handed over with a password somebody else chose. Without this card that stays
 * true forever: there is no other route in — "forgot password" mails a link, and the operator
 * script is the operator's. This is where a handed-over credential becomes the account
 * holder's own.
 *
 * Three fields rather than two. The current password is asked for because a live cookie
 * proves somebody opened this browser once, not that they are the account holder now — and
 * this is precisely the action that would lock the real one out. The confirmation field is
 * there because the input is masked and a typo here is a lockout, not a retry.
 */
export function PasswordCard({ labels }: { labels: PasswordLabels }) {
  const [state, action] = useActionState<PasswordFormState, FormData>(changePasswordAction, {});
  const form = useRef<HTMLFormElement>(null);

  /*
   * Clear the fields once it worked.
   *
   * Not cosmetic: they hold the old password and the new one in plain text in the DOM, and the
   * browser will offer to save whatever is still sitting there. Left alone, a second submit —
   * a stray Enter — replays a change that has already happened and fails on the now-wrong
   * current password, which reads as the first one not having worked.
   */
  useEffect(() => {
    if (state.notice) form.current?.reset();
  }, [state.notice]);

  return (
    <form ref={form} action={action} className="flex flex-col gap-3">
      <FormMessage error={state.error} notice={state.notice} />

      <p className="text-dim text-xs leading-relaxed">{labels.note}</p>

      {/*
        `dir="ltr"` on every one of them. A password is not Hebrew, and inside an RTL form the
        masked dots and the caret otherwise start at the wrong edge — see the note in
        globals.css about what `text-align: start` resolves to here.
      */}
      <Field
        label={labels.current}
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        required
        dir="ltr"
      />
      <Field
        label={labels.next}
        name="newPassword"
        type="password"
        autoComplete="new-password"
        required
        dir="ltr"
      />
      <Field
        label={labels.confirm}
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        required
        dir="ltr"
      />

      <SubmitButton>{labels.submit}</SubmitButton>
    </form>
  );
}
