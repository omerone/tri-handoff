import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encryptSecret } from '@/lib/crypto/secretbox';
import {
  connectMt5Account,
  getTrade,
  listClosedTrades,
  listJournalVocabulary,
  updateTradeJournal,
} from '@/lib/db';
import { syncMt5 } from '@/lib/mt5/sync';
import { cleanup, createTenantFixture, crossTenantContext, type Fixture } from '../helpers/fixtures';

/**
 * The journal is the only part of a trade the broker does not know about, which makes it the
 * only part that a sync could destroy. Everything else in a trade row is rewritten from the
 * broker on every login; if the journal columns were in that set, a routine refresh would
 * silently erase a month of a trader's own notes and there would be no way to get them back.
 *
 * That is the property this file exists for.
 */

let alice: Fixture;
let bob: Fixture;
let tradeId: string;

beforeAll(async () => {
  alice = await createTenantFixture();
  bob = await createTenantFixture();

  await connectMt5Account(alice.ctx, {
    login: '50214437',
    server: 'MetaQuotes-Demo',
    investorPwEncrypted: encryptSecret('read-only'),
    accountCurrency: 'USD',
  });
  await syncMt5(alice.ctx, 'backfill');

  tradeId = (await listClosedTrades(alice.ctx))[0]!.id;
});

afterAll(cleanup);

describe('writing a journal', () => {
  it('stores every field', async () => {
    expect(
      await updateTradeJournal(alice.ctx, tradeId, {
        note: 'Clean break of the range, waited for the retest.',
        tags: ['breakout', 'patient'],
        rating: 4,
        mood: 'calm',
        strategy: 'Breakout',
      }),
    ).toBe(true);

    const trade = await getTrade(alice.ctx, tradeId);
    expect(trade).toMatchObject({
      note: 'Clean break of the range, waited for the retest.',
      tags: ['breakout', 'patient'],
      rating: 4,
      mood: 'calm',
      strategy: 'Breakout',
    });
  });

  it('clears a field when it is emptied', async () => {
    // "Not rated" is a real state, distinct from one star, and the UI offers a way back to
    // it — so null has to survive the round trip.
    await updateTradeJournal(alice.ctx, tradeId, {
      note: null,
      tags: [],
      rating: null,
      mood: null,
      strategy: 'Breakout',
    });

    const trade = await getTrade(alice.ctx, tradeId);
    expect(trade).toMatchObject({ note: null, tags: [], rating: null, mood: null });
    expect(trade!.strategy).toBe('Breakout');
  });
});

describe('a sync must not touch the journal', () => {
  it('leaves notes, tags, rating, mood and strategy alone', async () => {
    const journal = {
      note: 'Held through the pullback. Would take again.',
      tags: ['breakout', 'a-plus'],
      rating: 5,
      mood: 'calm',
      strategy: 'Breakout',
    };
    await updateTradeJournal(alice.ctx, tradeId, journal);

    // The sync that runs on every login, and again on every refresh.
    const result = await syncMt5(alice.ctx, 'login');
    expect(result.status).toBe('success');
    // It really did rewrite this trade — otherwise the test proves nothing.
    expect(result.status === 'success' && result.updated).toBeGreaterThan(0);

    expect(await getTrade(alice.ctx, tradeId)).toMatchObject(journal);
  });

  it('still updates the broker-owned fields', async () => {
    const before = await getTrade(alice.ctx, tradeId);
    await syncMt5(alice.ctx, 'manual');
    const after = await getTrade(alice.ctx, tradeId);

    // The sync is doing its job; it is simply blind to five columns.
    expect(after!.profit).toBe(before!.profit);
    expect(after!.symbol).toBe(before!.symbol);
  });
});

describe('vocabulary', () => {
  it('offers back what the trader has already written', async () => {
    const trades = await listClosedTrades(alice.ctx);
    await updateTradeJournal(alice.ctx, trades[1]!.id, {
      note: null,
      tags: ['reversal'],
      rating: null,
      mood: 'anxious',
      strategy: 'Mean reversion',
    });

    const vocabulary = await listJournalVocabulary(alice.ctx);
    expect(vocabulary.strategies).toContain('Breakout');
    expect(vocabulary.strategies).toContain('Mean reversion');
    expect(vocabulary.tags).toEqual(expect.arrayContaining(['breakout', 'a-plus', 'reversal']));
    expect(vocabulary.moods).toEqual(expect.arrayContaining(['calm', 'anxious']));
  });

  it('lists each value once, however many trades carry it', async () => {
    const vocabulary = await listJournalVocabulary(alice.ctx);
    expect(new Set(vocabulary.strategies).size).toBe(vocabulary.strategies.length);
    expect(new Set(vocabulary.tags).size).toBe(vocabulary.tags.length);
  });

  it("does not offer another tenant's vocabulary", async () => {
    // Strategy names are the trader's own thinking; leaking them across domains would be a
    // small breach of exactly the kind the whole tenancy model exists to prevent.
    expect(await listJournalVocabulary(bob.ctx)).toEqual({
      strategies: [],
      tags: [],
      moods: [],
    });
  });
});

describe('tenant isolation', () => {
  it("will not read another tenant's trade", async () => {
    expect(await getTrade(crossTenantContext(bob, alice), tradeId)).toBeNull();
  });

  it("will not write to another tenant's trade", async () => {
    const before = await getTrade(alice.ctx, tradeId);

    expect(
      await updateTradeJournal(crossTenantContext(bob, alice), tradeId, {
        note: 'hijacked',
        tags: [],
        rating: 1,
        mood: null,
        strategy: null,
      }),
    ).toBe(false);

    expect((await getTrade(alice.ctx, tradeId))!.note).toBe(before!.note);
  });
});
