'use client';

import { useActionState, useState } from 'react';
import { Field, FormMessage, SubmitButton } from '@/components/ui/form';
import {
  deleteTenantAction,
  setClientPasswordAction,
  updateTenantAction,
  type TenantActionState,
} from '../tenant-actions';

export function EditTenantForm({
  tenantId,
  defaults,
}: {
  tenantId: string;
  defaults: { name: string; domain: string; notes: string };
}) {
  const [state, action] = useActionState<TenantActionState, FormData>(updateTenantAction, {});

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="tenantId" value={tenantId} />
      <FormMessage error={state.error} notice={state.notice} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Client name" name="name" required defaultValue={defaults.name} />
        <Field label="Domain" name="domain" required defaultValue={defaults.domain} />
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-dim text-xs font-semibold">Notes</span>
        <textarea
          name="notes"
          rows={3}
          defaultValue={defaults.notes}
          className="border-line bg-raised text-text rounded-[10px] border px-3 py-2.5 text-sm"
        />
      </label>

      <div>
        <SubmitButton>Save</SubmitButton>
      </div>
    </form>
  );
}

/**
 * Sets a client's password.
 *
 * Exists because self-service reset needs the client to receive email, and the case where
 * they cannot is exactly when they call the operator. The value is typed in plain text on
 * purpose — the operator has to read it back to the client — and it is never stored or
 * echoed anywhere else.
 */
export function SetPasswordForm({ tenantId }: { tenantId: string }) {
  const [state, action] = useActionState<TenantActionState, FormData>(setClientPasswordAction, {});

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="tenantId" value={tenantId} />
      <FormMessage error={state.error} notice={state.notice} />

      <p className="text-dim text-xs">
        For a client who cannot receive their reset email. Send it over a channel they already
        trust and have them change it.
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <Field label="New password" name="password" type="text" required autoComplete="off" />
        <SubmitButton>Set password</SubmitButton>
      </div>
    </form>
  );
}

/**
 * Deletion, behind a typed confirmation.
 *
 * The counts are shown because "delete client" is abstract and "delete 92 trades and 6
 * finance entries" is not. Typing the domain back is the same idea: it makes the action
 * deliberate rather than reachable by a misplaced click.
 */
export function DangerZone({
  tenantId,
  domain,
  counts,
}: {
  tenantId: string;
  domain: string;
  counts: { trades: number; financeEntries: number; longPositions: number };
}) {
  const [state, action] = useActionState<TenantActionState, FormData>(deleteTenantAction, {});
  const [confirm, setConfirm] = useState('');
  const matches = confirm.trim().toLowerCase() === domain.toLowerCase();

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="domain" value={domain} />
      <FormMessage error={state.error} />

      <p className="text-xs leading-relaxed">
        Deleting this client removes {counts.trades} trades, {counts.financeEntries} finance
        entries and {counts.longPositions} long positions along with their account. There is no
        undo.
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-dim text-xs font-semibold">
            Type <span className="tri-num text-text">{domain}</span> to confirm
          </span>
          <input
            name="confirm"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="off"
            className="border-line bg-raised text-text rounded-[10px] border px-3 py-2.5 text-sm"
          />
        </label>

        <button
          type="submit"
          disabled={!matches}
          className="bg-neg rounded-[10px] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"
        >
          Delete client
        </button>
      </div>
    </form>
  );
}
