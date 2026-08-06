'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth/session';
import { limitKey, LIMITS } from '@/lib/auth/limits';
import { encryptSecret } from '@/lib/crypto/secretbox';
import {
  connectMt5Account,
  consumeRateLimit,
  countSyncedTrades,
  deleteAllSnapshots,
  deleteAllTrades,
  disconnectMt5Account,
  getMt5Account,
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

  const existing = await getMt5Account(session.ctx);
  const isDifferentAccount = existing !== null && existing.login !== credentials.login;

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
    const trades = await countSyncedTrades(session.ctx);
    return {
      confirmReplace: {
        trades,
        body: t('replaceBody', {
          trades,
          fromLogin: existing.login,
          toLogin: credentials.login,
        }),
      },
    };
  }

  await connectMt5Account(session.ctx, {
    login: credentials.login,
    server: credentials.server,
    investorPwEncrypted: encryptSecret(credentials.investorPassword),
    accountCurrency: verified.account.currency,
  });

  // Confirmed above: a different account number means the stored history is another book's.
  // The balance history goes with it — a chart that steps from one account's equity to
  // another's would read as a deposit or a catastrophe, and it is neither.
  if (isDifferentAccount) {
    await deleteAllTrades(session.ctx);
    await deleteAllSnapshots(session.ctx);
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
