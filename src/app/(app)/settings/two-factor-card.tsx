'use client';

import { ShieldCheck, ShieldOff } from 'lucide-react';
import { useActionState, useState } from 'react';
import { Field, FormMessage, SubmitButton } from '@/components/ui/form';
import { QrCode } from '@/components/ui/qr-code';
import {
  beginTwoFactorAction,
  confirmTwoFactorAction,
  disableTwoFactorAction,
  regenerateRecoveryCodesAction,
  type TwoFactorState,
} from './two-factor-actions';

export type TwoFactorLabels = {
  offTitle: string;
  offBody: string;
  enable: string;
  password: string;
  scanTitle: string;
  scanBody: string;
  manualKey: string;
  code: string;
  confirm: string;
  cancel: string;
  qrAlt: string;
  onSince: string;
  codesLeft: string;
  codesLow: string;
  saveCodesTitle: string;
  saveCodesBody: string;
  codesSaved: string;
  regenerate: string;
  regenerateBody: string;
  disable: string;
  disableBody: string;
};

/**
 * The second factor, as four states of one card.
 *
 * Off → setting up → showing the recovery codes → on. They are states rather than pages
 * because the middle two are moments, not places: a QR that has been scanned is worthless
 * and a set of recovery codes is shown exactly once, so neither can be returned to by
 * navigating back, and neither should look like somewhere you could.
 *
 * Every action re-authenticates with the password. The card is behind a session, and a
 * session is the thing 2FA exists to stop being sufficient.
 */
export function TwoFactorCard({
  labels,
  enabledAt,
  recoveryCodesLeft,
}: {
  labels: TwoFactorLabels;
  /** Formatted on the server, where the locale and time zone live. Null when 2FA is off. */
  enabledAt: string | null;
  recoveryCodesLeft: number;
}) {
  const [begin, beginAction] = useActionState<TwoFactorState, FormData>(beginTwoFactorAction, {});
  const [confirm, confirmAction] = useActionState<TwoFactorState, FormData>(
    confirmTwoFactorAction,
    {},
  );
  const [regenerate, regenerateAction] = useActionState<TwoFactorState, FormData>(
    regenerateRecoveryCodesAction,
    {},
  );
  const [disable, disableAction] = useActionState<TwoFactorState, FormData>(
    disableTwoFactorAction,
    {},
  );

  /*
   * `dismissed` is what turns the codes screen back into the ordinary "on" card. It is local
   * state and not a server round trip, because acknowledging that you have written something
   * down is not a fact the server has any use for.
   */
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState<'none' | 'regenerate' | 'disable'>('none');

  const freshCodes = !dismissed
    ? (confirm.recoveryCodes ?? regenerate.recoveryCodes ?? null)
    : null;

  // The setup payload survives a wrong code — see the action — so this reads the confirm
  // step's copy first and falls back to the one the begin step returned.
  const setup = confirm.setup ?? begin.setup;

  if (freshCodes) {
    return (
      <div className="flex flex-col gap-3">
        <FormMessage notice={confirm.notice ?? regenerate.notice} />
        <div>
          <p className="text-sm font-bold">{labels.saveCodesTitle}</p>
          <p className="text-dim mt-1 text-xs leading-relaxed">{labels.saveCodesBody}</p>
        </div>

        <ul
          dir="ltr"
          className="border-line bg-raised grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-[10px] border p-3 font-mono text-xs"
        >
          {freshCodes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>

        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="bg-brand self-start rounded-[10px] px-4 py-2.5 text-sm font-bold text-on-brand"
        >
          {labels.codesSaved}
        </button>
      </div>
    );
  }

  if (setup && !enabledAt) {
    return (
      <form action={confirmAction} className="flex flex-col gap-3">
        <FormMessage error={confirm.error} />
        <div>
          <p className="text-sm font-bold">{labels.scanTitle}</p>
          <p className="text-dim mt-1 text-xs leading-relaxed">{labels.scanBody}</p>
        </div>

        <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
          <QrCode text={setup.uri} label={labels.qrAlt} />
          <div className="min-w-0">
            <p className="text-dim text-[11px] font-semibold">{labels.manualKey}</p>
            {/* `select-all` so a phone that cannot scan gets the key with one tap. */}
            <p dir="ltr" className="mt-1 font-mono text-xs break-all select-all">
              {setup.manualKey}
            </p>
          </div>
        </div>

        <Field
          label={labels.code}
          name="code"
          required
          autoFocus
          dir="ltr"
          inputMode="numeric"
          autoComplete="one-time-code"
        />
        <SubmitButton>{labels.confirm}</SubmitButton>
      </form>
    );
  }

  if (!enabledAt) {
    return (
      <form action={beginAction} className="flex flex-col gap-3">
        <FormMessage error={begin.error} notice={disable.notice} />
        <p className="text-dim flex items-start gap-2 text-xs leading-relaxed">
          <ShieldOff size={14} className="mt-0.5 shrink-0" aria-hidden />
          <span>{labels.offBody}</span>
        </p>
        <Field
          label={labels.password}
          name="password"
          type="password"
          autoComplete="current-password"
          required
          dir="ltr"
        />
        <SubmitButton>{labels.enable}</SubmitButton>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <FormMessage error={regenerate.error || disable.error} />
      <p className="text-pos flex items-start gap-2 text-xs leading-relaxed">
        <ShieldCheck size={14} className="mt-0.5 shrink-0" aria-hidden />
        <span>{labels.onSince}</span>
      </p>

      <p className={`text-xs ${recoveryCodesLeft <= 2 ? 'text-neg' : 'text-dim'}`}>
        {recoveryCodesLeft <= 2 ? labels.codesLow : labels.codesLeft}
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setExpanded(expanded === 'regenerate' ? 'none' : 'regenerate')}
          className="border-line text-text rounded-[10px] border px-3 py-2 text-xs font-semibold"
        >
          {labels.regenerate}
        </button>
        <button
          type="button"
          onClick={() => setExpanded(expanded === 'disable' ? 'none' : 'disable')}
          className="text-neg border-neg/40 rounded-[10px] border px-3 py-2 text-xs font-semibold"
        >
          {labels.disable}
        </button>
      </div>

      {/*
        Both destructive controls open the same shape: an explanation of what is about to stop
        working, then the password. Neither is a one-tap action — replacing the codes silently
        invalidates a sheet of paper someone is relying on, and turning 2FA off removes the
        protection without anything else changing on screen.
      */}
      {expanded === 'regenerate' ? (
        <form action={regenerateAction} className="flex flex-col gap-3">
          <p className="text-dim text-xs leading-relaxed">{labels.regenerateBody}</p>
          <Field
            label={labels.password}
            name="password"
            type="password"
            autoComplete="current-password"
            required
            dir="ltr"
          />
          <SubmitButton>{labels.regenerate}</SubmitButton>
        </form>
      ) : null}

      {expanded === 'disable' ? (
        <form action={disableAction} className="flex flex-col gap-3">
          <p className="text-dim text-xs leading-relaxed">{labels.disableBody}</p>
          <Field
            label={labels.password}
            name="password"
            type="password"
            autoComplete="current-password"
            required
            dir="ltr"
          />
          <SubmitButton>{labels.disable}</SubmitButton>
        </form>
      ) : null}
    </div>
  );
}
