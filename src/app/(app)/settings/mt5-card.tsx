'use client';

import { useTransition } from 'react';
import { Landmark, Shield } from 'lucide-react';
import { Num } from '@/components/ui/kpi';
import { Mt5ConnectWizard, type WizardLabels } from './mt5-wizard';
import { disconnectMt5Action } from './mt5-actions';

export type Mt5CardLabels = WizardLabels & {
  login: string;
  server: string;
  investorPassword: string;
  connect: string;
  disconnect: string;
  disconnectConfirm: string;
  investor: string;
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
  return account ? <Connected account={account} labels={labels} /> : <Mt5ConnectWizard labels={labels} />;
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
