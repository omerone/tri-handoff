'use client';

import { useActionState, useTransition } from 'react';
import { Landmark, Shield, TriangleAlert } from 'lucide-react';
import { Field, FormMessage, SubmitButton } from '@/components/ui/form';
import { Num } from '@/components/ui/kpi';
import { connectMt5Action, disconnectMt5Action, type Mt5FormState } from './mt5-actions';

export type Mt5CardLabels = {
  login: string;
  server: string;
  investorPassword: string;
  connect: string;
  disconnect: string;
  disconnectConfirm: string;
  investor: string;
  investorWarning: string;
  notConnected: string;
  notConnectedHint: string;
  backfillNote: string;
  lastSync: string;
  balance: string;
  equity: string;
  never: string;
};

export type ConnectedAccount = {
  login: string;
  server: string;
  status: string;
  lastSync: string | null;
  balance: string | null;
  equity: string | null;
};

export function Mt5Card({
  account,
  labels,
}: {
  account: ConnectedAccount | null;
  labels: Mt5CardLabels;
}) {
  return account ? <Connected account={account} labels={labels} /> : <ConnectForm labels={labels} />;
}

/**
 * The investor-password warning is not fine print.
 *
 * A trader handing over their master password would be giving a third-party service the
 * ability to trade their account — the exact risk SPEC §5 avoids by making TRi read-only. So
 * the warning sits above the field rather than below the form, and it says what TRi cannot
 * do rather than what the user should not do.
 */
function InvestorWarning({ text }: { text: string }) {
  return (
    <div className="border-warn/30 bg-warn/10 flex gap-2 rounded-[10px] border px-3 py-2.5">
      <TriangleAlert size={15} className="text-warn mt-px shrink-0" aria-hidden />
      <p className="text-text/90 text-xs leading-relaxed">{text}</p>
    </div>
  );
}

function ConnectForm({ labels }: { labels: Mt5CardLabels }) {
  const [state, action] = useActionState<Mt5FormState, FormData>(connectMt5Action, {});

  return (
    <form action={action} className="flex flex-col gap-3">
      <div>
        <div className="text-sm font-bold">{labels.notConnected}</div>
        <p className="text-dim mt-1 text-xs">{labels.notConnectedHint}</p>
      </div>

      <InvestorWarning text={labels.investorWarning} />
      <FormMessage error={state.error} notice={state.notice} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={labels.login} name="login" required dir="ltr" placeholder="50214437" />
        <Field
          label={labels.server}
          name="server"
          required
          dir="ltr"
          placeholder="MetaQuotes-Live01"
        />
      </div>
      <Field
        label={labels.investorPassword}
        name="investorPassword"
        type="password"
        autoComplete="off"
        required
        dir="ltr"
      />

      <p className="text-dim text-xs">{labels.backfillNote}</p>
      <div>
        <SubmitButton>{labels.connect}</SubmitButton>
      </div>
    </form>
  );
}

function Connected({ account, labels }: { account: ConnectedAccount; labels: Mt5CardLabels }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="bg-raised flex h-10 w-10 items-center justify-center rounded-[10px]">
            <Landmark size={18} className="text-brand" aria-hidden />
          </div>
          <div>
            <div className="text-sm font-bold">
              <Num>#{account.login}</Num>
            </div>
            <div className="text-dim text-[11px]">
              {labels.server}: {account.server}
            </div>
          </div>
        </div>

        <span className="bg-pos/15 text-pos inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap">
          <Shield size={11} aria-hidden /> {labels.investor}
        </span>
      </div>

      <dl className="border-line grid grid-cols-3 gap-3 border-t pt-3 text-xs">
        <div>
          <dt className="text-dim">{labels.lastSync}</dt>
          <dd className="mt-0.5">
            <Num>{account.lastSync ?? labels.never}</Num>
          </dd>
        </div>
        <div>
          <dt className="text-dim">{labels.balance}</dt>
          <dd className="mt-0.5">
            <Num>{account.balance ?? '—'}</Num>
          </dd>
        </div>
        <div>
          <dt className="text-dim">{labels.equity}</dt>
          <dd className="mt-0.5">
            <Num>{account.equity ?? '—'}</Num>
          </dd>
        </div>
      </dl>

      <InvestorWarning text={labels.investorWarning} />

      <div>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!window.confirm(labels.disconnectConfirm)) return;
            startTransition(() => {
              void disconnectMt5Action();
            });
          }}
          className="border-line bg-raised text-dim hover:text-neg rounded-[10px] border px-3 py-2 text-xs disabled:opacity-60"
        >
          {labels.disconnect}
        </button>
      </div>
    </div>
  );
}
