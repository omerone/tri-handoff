'use client';

import { useTransition } from 'react';
import { Landmark, Shield } from 'lucide-react';
import { Num } from '@/components/ui/kpi';
import { Mt5ConnectWizard, type WizardLabels } from './mt5-wizard';
import { disconnectMt5Action } from './mt5-actions';

/** `login`, `server`, `connect` and `investorWarning` come from `WizardLabels` — both halves
    of this card name the same things, and the wizard needs them too. */
export type Mt5CardLabels = WizardLabels & {
  /** Slot titles, so two identical wizards are not two identical invitations. */
  swingAccount: string;
  dayAccount: string;
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
  /** What the account is for. Null for one connected before purposes existed. */
  purpose: 'day' | 'swing' | null;
  status: string;
  /**
   * Split, because `dd/mm/yyyy HH:mm` is one unbreakable run and the cell it sits in is a
   * third of a card. As a single string it overflowed its column and printed across the
   * balance beside it; as two it wraps between the date and the time when it has to.
   */
  lastSync: { date: string; time: string } | null;
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
  /*
   * A slot is a purpose, and an account sits in the slot it is *for*.
   *
   * This used to place `accounts[index]` — creation order — beside a heading chosen by the
   * same index, which is only ever right by luck. Connect the day account first and it
   * becomes `accounts[0]`, is drawn under "Swing account", and the one empty slot left is
   * slot 1 — so the actual swing account is connected as `day` too, every trade in the
   * product is stamped `day`, and the Swing tab is permanently empty. Matching on the stored
   * purpose means the heading, the wizard's submission and the database always agree.
   */
  const PURPOSES = ['swing', 'day'] as const;
  // An account connected before purposes existed has none. It takes the first slot no
  // account claims, so it is visible and disconnectable rather than hidden by its own age.
  const unassigned = accounts.filter((account) => account.purpose === null);
  const slots = PURPOSES.map(
    (purpose) =>
      accounts.find((account) => account.purpose === purpose) ?? unassigned.shift() ?? null,
  );

  return (
    /*
     * Two slots when there is room for two, one when there is not — decided by the width the
     * card actually gets, not by the width of the screen.
     *
     * `sm:grid-cols-2` asked the wrong question. This card sits in one half of a two-column
     * settings page, so on a 1280px desktop each slot was about 230px: an account number, a
     * server name, a read-only badge and three figures, in less room than a phone gives them.
     * The badge overflowed onto the neighbouring card and the sync time printed across the
     * balance. `sm:` was satisfied either way, because the viewport was never the constraint.
     *
     * `auto-fit` with a real minimum is the same rule the content needs. 18rem is measured
     * rather than chosen: below it the three figures at the foot of a connected slot stop
     * fitting across and stack, which turns the slot into a tall thin strip. So on this page,
     * where the card gets half the width, the two slots sit one above the other and each is
     * readable; on a wider screen they go side by side.
     *
     * `min(18rem,100%)` rather than a bare `18rem`, because a track minimum is a floor the
     * grid will overflow to honour: with the plain value the settings page was 338 pixels wide
     * on a 320 pixel screen, and it was the only page in the product that was. Wrapping it in
     * `min()` says "18rem, unless that is more than there is".
     */
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(18rem,100%),1fr))] items-start gap-4">
      {slots.map((account, index) => (
        /*
          `min-w-0`, which a grid child needs and does not get.

          A grid track sizes to `auto`, and `auto` will not go below its content's minimum —
          so one unbreakable thing inside a slot (the wizard's progress bar, a server name
          with no spaces) widened the column past the card, past `main`, and the settings page
          scrolled sideways on a phone. The `mobile.spec` route check caught it; nothing on
          screen looked wrong, because the overflow was off the edge.
        */
        <section
          key={account?.id ?? `empty-${index}`}
          className="border-line flex min-w-0 flex-col gap-3 rounded-[14px] border p-4"
        >
          <header className="flex items-baseline justify-between gap-2">
            <h3 className="text-xs font-semibold">
              {PURPOSES[index] === 'swing' ? labels.swingAccount : labels.dayAccount}
            </h3>
            {account?.label ? <span className="text-dim text-[11px]">{account.label}</span> : null}
          </header>

          {account ? (
            <Connected account={account} labels={labels} />
          ) : (
            <Mt5ConnectWizard labels={labels} purpose={PURPOSES[index]} />
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
      {/* Wrapping, so the badge takes its own line rather than the card's edge. It is a fixed
          run of text that cannot be broken or shrunk, and in a row that only shrinks it went
          straight through the border and over the slot next door. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-3">
          <div className="bg-raised flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px]">
            <Landmark size={18} className="text-brand" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold">
              <Num>#{account.login}</Num>
            </div>
            {/* `break-all`: a server name is one token and some brokers write a long one. */}
            <div className="text-dim text-[11px] break-all">
              {labels.server}: {account.server}
            </div>
          </div>
        </div>

        <span className="bg-pos/15 text-pos inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold">
          <Shield size={11} className="shrink-0" aria-hidden /> {labels.investor}
        </span>
      </div>

      {/*
        Three figures across when three fit, two when they do not.

        The same `1fr` problem as the slots above, one level down: a grid track will happily be
        narrower than a run of digits that cannot break, and the sync time is half again as
        wide as either money figure. It printed over the balance.
      */}
      <dl className="border-line grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-x-4 gap-y-3 border-t pt-3 text-xs">
        <div className="min-w-0">
          <dt className="text-dim">{labels.lastSync}</dt>
          <dd className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5">
            {account.lastSync ? (
              <>
                <Num>{account.lastSync.date}</Num>
                <Num className="text-dim">{account.lastSync.time}</Num>
              </>
            ) : (
              <span>{labels.never}</span>
            )}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-dim">{labels.balance}</dt>
          <dd className="mt-0.5">
            <Num>{account.balance ?? '—'}</Num>
          </dd>
        </div>
        <div className="min-w-0">
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
