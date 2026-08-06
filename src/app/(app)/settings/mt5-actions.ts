'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth/session';
import { limitKey, LIMITS } from '@/lib/auth/limits';
import { encryptSecret } from '@/lib/crypto/secretbox';
import {
  connectMt5Account,
  Mt5AccountLimitError,
  consumeRateLimit,
  countSyncedTrades,
  deleteAllSnapshots,
  deleteTradesForAccount,
  disconnectMt5Account,
  listMt5Accounts,
} from '@/lib/db';
import { mt5Provider } from '@/lib/mt5';
import { syncMt5 } from '@/lib/mt5/sync';

export type Mt5FormState = {
  error?: string;
  notice?: string;
  /**
   * Set instead of connecting when the new account number is not the stored one.
   *
   * Connecting a different account discards the imported book, because that history belongs
   * to somebody else's account. That is the right behaviour and the wrong thing to do
   * silently: the button says "connect", the confirmation on *disconnect* promises in as many
   * words that imported trades survive, and the delete arrives with no count and no undo. It
   * emptied this deployment's book three times in one day.
   */
  confirmReplace?: {
    /** Already formatted here: only this side knows the counts, and only next-intl should
        be interpolating a message that has placeholders in it. */
    body: string;
    trades: number;
  };
};

const connectSchema = z.object({
  login: z.string().trim().min(1).max(40),
  server: z.string().trim().min(1).max(120),
  investorPassword: z.string().min(1).max(200),
  /**
   * Which book this connection feeds, from the slot the wizard sits in.
   *
   * Optional so an older client, or a form posted without it, still connects — the account
   * simply keeps the calendar rule for its trades instead of overriding it.
   */
  purpose: z.enum(['day', 'swing']).nullish(),
});

type Translate = Awaited<ReturnType<typeof getTranslations<'settings'>>>;

/**
 * Turns a refused connection into something the user can act on.
 *
 * The server name is the field most likely to be wrong and the least guessable — every broker
 * names its servers its own way, and the one in front of the trader is written in MetaTrader,
 * not in this form. When the provider answers with the names it *does* know for that broker,
 * they go straight into the message: "did you mean FTMO-Server4?" is a fix, "we couldn't reach
 * the MT5 server" is a shrug.
 */
function connectError(
  verified: { reason: string; suggestions?: string[] },
  t: Translate,
): string {
  if (verified.reason === 'invalid-credentials') return t('connectRejected');

  if (verified.reason === 'unknown-server') {
    const names = (verified.suggestions ?? []).slice(0, 3);
    return names.length > 0
      ? t('connectUnknownServerDidYouMean', { names: names.join(', ') })
      : t('connectUnknownServer');
  }

  return t('connectUnreachable');
}

/**
 * Connects the account.
 *
 * The credentials are proved against the provider *before* anything is written, so a typo
 * shows up as an error on the form rather than as a sync that silently fails every login.
 * The password is encrypted on the way in and never read back out to any UI — see
 * `readCredentialCiphertext`, the one function that can return it.
 */
export async function connectMt5Action(
  _prev: Mt5FormState,
  formData: FormData,
): Promise<Mt5FormState> {
  const session = await requireSession();
  const t = await getTranslations('settings');

  const parsed = connectSchema.safeParse({
    login: formData.get('login'),
    server: formData.get('server'),
    investorPassword: formData.get('investorPassword'),
    purpose: formData.get('purpose'),
  });
  if (!parsed.success) return { error: t('connectInvalid') };

  const verdict = await consumeRateLimit(
    limitKey('mt5-connect', session.ctx.userId),
    LIMITS.syncManual.limit,
    LIMITS.syncManual.windowMs,
  );
  if (!verdict.allowed) return { error: t('tooSoon') };

  const credentials = {
    login: parsed.data.login,
    server: parsed.data.server,
    investorPassword: parsed.data.investorPassword,
    // Whose account this is. `verify` runs before anything is stored, and without this the
    // provider would look the account up by number alone and happily confirm somebody else's.
    accountKey: session.ctx.userId,
  };

  const verified = await mt5Provider().verify(credentials);
  if (!verified.ok) {
    return { error: connectError(verified, t) };
  }

  /*
   * "Replacing" is a question about *this slot*, not about the trader's first account.
   *
   * This compared the new login against `getMt5Account` — `listMt5Accounts[0]`, ordered by
   * creation — so filling the empty second slot was read as replacing the first. The wizard
   * then offered two buttons: confirm, which deleted every synced trade and every balance
   * snapshot the trader had, or cancel. There was no path through the interface that connected
   * a second account without destroying the first one's book, which is the opposite of the
   * feature. The journal columns are not recoverable by re-syncing: `TradeUpsert` deliberately
   * excludes note, tags, rating, mood, strategy and both review answers.
   *
   * The slot is named by the purpose the wizard submitted. An account with no purpose — one
   * connected before purposes existed — is the slot's occupant only when nothing else claims
   * it, which mirrors how the card draws them.
   */
  const purpose = parsed.data.purpose ?? null;
  const connected = await listMt5Accounts(session.ctx);
  const inThisSlot =
    (purpose === null
      ? connected[0]
      : (connected.find((account) => account.purpose === purpose) ??
        connected.find((account) => account.purpose === null))) ?? null;

  const isDifferentAccount =
    inThisSlot !== null &&
    (inThisSlot.login !== credentials.login || inThisSlot.server !== credentials.server);

  /*
   * Ask before discarding a book, and ask *here* — before `connectMt5Account` writes
   * anything. Bailing out after the account row is replaced would leave the credentials
   * pointing at the new account and the trades still belonging to the old one, which is a
   * worse state than either answer to the question.
   *
   * The count comes from the database rather than from the caller: it is the number the
   * person is being asked to agree to lose, and it must not be something the form can lie
   * about.
   */
  if (isDifferentAccount && formData.get('confirmReplace') !== 'yes') {
    // Synced only: `deleteAllTrades` spares the manual ones, so counting the whole book
    // would warn about losing trades that survive.
    // This account's trades, not the whole book: the other slot's history is not being
    // replaced and warning about it would overstate what the trader is agreeing to lose.
    const trades = await countSyncedTrades(session.ctx, inThisSlot.id);
    return {
      confirmReplace: {
        trades,
        body: t('replaceBody', {
          trades,
          fromLogin: inThisSlot.login,
          toLogin: credentials.login,
        }),
      },
    };
  }

  try {
    await connectMt5Account(session.ctx, {
      login: credentials.login,
      server: credentials.server,
      investorPwEncrypted: encryptSecret(credentials.investorPassword),
      accountCurrency: verified.account.currency,
      purpose: parsed.data.purpose ?? null,
    });
  } catch (error) {
    // The screen draws exactly two slots, so this is unreachable from the UI — which is the
    // reason to handle it rather than to skip it. An unreachable path that throws is a server
    // action returning a stack trace the first time the assumption stops holding.
    if (error instanceof Mt5AccountLimitError) return { error: t('accountLimit') };
    throw error;
  }

  /*
   * Confirmed above: this slot now points at a different broker account, so the history it
   * held belongs to a book the trader is no longer reading.
   *
   * Scoped to that account. Deleting every synced trade would take the *other* slot's book
   * with it, which is the bug this whole block used to be. Snapshots are only cleared when
   * nothing else is connected: they carry no account column, so with a second account still
   * syncing they are still partly its history, and a chart missing half its own past is worse
   * than one that steps.
   */
  if (isDifferentAccount && inThisSlot) {
    await deleteTradesForAccount(session.ctx, inThisSlot.id);
    if (connected.length === 1) await deleteAllSnapshots(session.ctx);
  }

  const result = await syncMt5(session.ctx, 'backfill');
  revalidatePath('/', 'layout');

  if (result.status === 'error') return { error: t('connectSyncFailed') };
  return {
    notice: result.status === 'success' ? t('connected', { count: result.imported }) : t('connected', { count: 0 }),
  };
}

export async function disconnectMt5Action(mt5AccountId?: string): Promise<void> {
  const session = await requireSession();
  // The id names one account. Omitted — which nothing in the UI does any more — it clears
  // them all, which is what account deletion wants.
  await disconnectMt5Account(session.ctx, mt5AccountId);
  revalidatePath('/', 'layout');
}

export type RefreshResult =
  /**
   * Both counts, because the pill reports what the press actually bought. `imported` alone
   * reads as "nothing happened" on a refresh that corrected the commission and swap on a
   * dozen trades the broker settled late — which is exactly what the two-day overlap window
   * exists to catch.
   */
  | {
      status: 'success';
      imported: number;
      updated: number;
      /**
       * What to show on the pill, already translated.
       *
       * Formatted here rather than templated on the client: the counts only exist after the
       * sync, and next-intl's formatting — plurals, digit shaping, the lot — belongs on the
       * server side of the boundary. A client doing `.replace('{imported}', …)` is a client
       * quietly reimplementing a message formatter.
       */
      note: string;
    }
  | { status: 'skipped' }
  | { status: 'rate-limited' }
  | { status: 'error' };

/**
 * The manual "refresh data" button, and the automatic run after a login.
 *
 * Rate limited per user: a full backfill is a real amount of work on the provider's side,
 * and SPEC §2 puts that bill on the client.
 */
export async function refreshSyncAction(automatic = false): Promise<RefreshResult> {
  const session = await requireSession();

  const verdict = await consumeRateLimit(
    limitKey('mt5-sync', session.ctx.userId),
    LIMITS.syncManual.limit,
    LIMITS.syncManual.windowMs,
  );
  if (!verdict.allowed) return { status: 'rate-limited' };

  const result = await syncMt5(session.ctx, automatic ? 'login' : 'manual');
  revalidatePath('/', 'layout');

  if (result.status === 'success') {
    const tSync = await getTranslations('sync');
    return {
      status: 'success',
      imported: result.imported,
      updated: result.updated,
      note:
        result.imported === 0 && result.updated === 0
          ? tSync('upToDate')
          : tSync('pulled', { imported: result.imported, updated: result.updated }),
    };
  }
  if (result.status === 'skipped') return { status: 'skipped' };
  return { status: 'error' };
}
