'use client';

import { MAX_MT5_ACCOUNTS } from '@/lib/db/mt5-accounts';

import { useTransition } from 'react';
import { Landmark, Shield } from 'lucide-react';
import { Num } from '@/components/ui/kpi';
import { Mt5ConnectWizard, type WizardLabels } from './mt5-wizard';
import { disconnectMt5Action } from './mt5-actions';

/** `login`, `server`, `connect` and `investorWarning` come from `WizardLabels` — both halves
    of this card name the same things, and the wizard needs them too. */
export type Mt5CardLabels = WizardLabels & {
  /** Slot titles, so two identical wizards are not two identical invitations. */
  firstAccount: string;
  secondAccount: string;
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
 * Both account slots, always drawn, whether or not anything is in them.
 *
 * A trader runs a day account and a swing account and the journal keeps the two books apart.
 * The screen used to show one wizard and only reveal the second slot once the first was
 * connected, which answers "can I connect two?" only for people who had already committed to
 * one — everybody else read a product that takes a single broker account.
 *
 * So there are two blocks from the start and each is complete on its own: a connected account
 * with its numbers, or an invitation to connect one. Nothing appears or disappears as accounts
 * come and go; a slot only changes what it contains.
 */
export function Mt5Card({
  accounts,
  labels,
}: {
  accounts: readonly ConnectedAccount[];
  labels: Mt5CardLabels;
}) {
  // Positional, and deliberately not sorted by anything: an account keeps the slot it was
  // connected into, so the card a trader learned to read does not move when the other one is
  // disconnected. `listMt5Accounts` orders by creation for the same reason.
  const slots = Array.from({ length: MAX_MT5_ACCOUNTS }, (_, index) => accounts[index] ?? null);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {slots.map((account, index) => (
        <section
          key={account?.id ?? `empty-${index}`}
          className="border-line flex flex-col gap-3 rounded-[14px] border p-4"
        >
          <header className="flex items-baseline justify-between gap-2">
            <h3 className="text-xs font-semibold">
              {index === 0 ? labels.firstAccount : labels.secondAccount}
            </h3>
            {account?.label ? (
              <span className="text-dim text-[11px]">{account.label}</span>
            ) : null}
          </header>

          {account ? (
            <Connected account={account} labels={labels} />
          ) : (
            <Mt5ConnectWizard labels={labels} />
          )}
        </section>
      ))}
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
