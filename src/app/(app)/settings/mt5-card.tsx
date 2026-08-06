'use client';

import { useTransition } from 'react';
import { Landmark, Shield } from 'lucide-react';
import { Num } from '@/components/ui/kpi';
import { Mt5ConnectWizard, type WizardLabels } from './mt5-wizard';
import { disconnectMt5Action } from './mt5-actions';

/** `login`, `server`, `connect` and `investorWarning` come from `WizardLabels` — both halves
    of this card name the same things, and the wizard needs them too. */
export type Mt5CardLabels = WizardLabels & {
  /** Opens the wizard again under a list that already has an account in it. */
  addAnother: string;
  twoAccounts: string;
  slotEmpty: string;
  disconnect: string;
  disconnectConfirm: string;
  investor: string;
  lastSync: string;
  balance: string;
  equity: string;
  never: string;
};

export type ConnectedAccount = {
  id: string;
  login: string;
  server: string;
  /** What the trader calls it — "Day", "Swing". Null until they name it. */
  label: string | null;
  status: string;
  lastSync: string | null;
  balance: string | null;
  equity: string | null;
};

/**
 * Every connected broker account, and the way to add the other one.
 *
 * A trader can run a day account and a swing account, and the journal keeps them apart — so
 * this card lists them rather than describing "the" account.
 *
 * Both slots are on screen from the start, and that is the point. The second one used to live
 * behind a collapsed `<details>`, which is the same mistake as hiding it entirely: someone
 * setting up their first account has no reason to open a disclosure to find out whether a
 * feature exists, so as far as they know it does not. Saying "you can connect two" while the
 * first is still being asked for costs one line and answers the question before it is asked.
 */
export function Mt5Card({
  accounts,
  labels,
}: {
  accounts: readonly ConnectedAccount[];
  labels: Mt5CardLabels;
}) {
  if (accounts.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <Mt5ConnectWizard labels={labels} />
        {/*
          Said while the first account is still being asked for, not after. Whoever is looking
          at this screen is deciding how to set the product up, and "there is room for the
          swing account too" is part of that decision.
        */}
        <p className="text-dim text-xs leading-relaxed">{labels.twoAccounts}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {accounts.map((account) => (
        <Connected key={account.id} account={account} labels={labels} />
      ))}
      <div className="border-line border-t pt-3">
        <div className="text-dim mb-3 text-xs font-semibold">{labels.addAnother}</div>
        <Mt5ConnectWizard labels={labels} />
      </div>
    </div>
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
              {account.label ? (
                <span className="text-dim ms-2 text-[11px] font-normal">{account.label}</span>
              ) : null}
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
              // Named, not implied: with two accounts connected, "disconnect" without an id
              // would take both and the confirmation only asked about one.
              void disconnectMt5Action(account.id);
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
