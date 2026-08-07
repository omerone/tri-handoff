import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

/**
 * The little notebook at the end of a trade — the screen a client read to find the bug.
 *
 * Their words: "the system can't read the risk and the RR, because 99.9% of the trades have
 * stops — you can see it in the trade report, the little notebook at the end of every trade."
 * They were right twice over. The R multiple was missing on almost every trade, and the line
 * under the dash said the trade had no stop loss, on a card that prints the stop loss a few
 * rows further down. Two contradicting facts on one screen, and the wrong one was offered as
 * the explanation.
 *
 * So what is asserted is the pair, not either half: whatever the card says about the missing R
 * has to agree with the stop loss the same card is showing. No unit test can make that
 * comparison — the contradiction only exists once both are rendered together, which is how it
 * survived a suite that was green.
 *
 * Read as text rather than through per-field locators. The subject is what a person reads on
 * the card, and a locator naming the markup would stay green on a screen that says something
 * absurd, as long as it said it in the expected div.
 */

/**
 * Open a trade and return everything its card says.
 *
 * `nth` picks which one, because the interesting trades are not the first: the ones this file
 * is about are the ones with no R multiple, and a book where the fix works is mostly trades
 * that have one.
 */
async function openTrade(page: Page, nth = 0): Promise<string> {
  await page.goto('/trades?range=max');

  // Found by the link rather than the row, because the two viewports open a trade differently:
  // below `md` the whole card is the link, and from `md` up the row is a table and the way in
  // is the notebook icon in its last cell. `visible` picks whichever of the two is on screen —
  // each renders the other and hides it.
  const links = page.locator('a[href*="/trades/"]').filter({ visible: true });
  await links.first().waitFor();
  await links.nth(nth).click();
  await expect(page).toHaveURL(/\/trades\/[0-9a-z]+$/i);
  return page.locator('main').innerText();
}

/** How many trades the current page offers, bounding the search below. */
async function tradeCount(page: Page): Promise<number> {
  await page.goto('/trades?range=max');
  const links = page.locator('a[href*="/trades/"]').filter({ visible: true });
  await links.first().waitFor();
  return links.count();
}

/** The value printed under a label on the trade card — a price, a figure, or a dash. */
const valueOf = (card: string, label: string) =>
  new RegExp(`${label}\\s*\\n?\\s*(\\S+)`).exec(card)?.[1];

/** Marks the rows this file creates, so cleanup never reaches a seeded trade. */
const SYMBOL = 'E2ERPT';

/**
 * A closed trade with a stop the trader trailed past their entry.
 *
 * Written straight to the database rather than through the form, because the manual-entry form
 * takes a typed risk and this has to be a trade the *system* declined to price. It borrows the
 * user and account of a trade already in the book so it lands in the same tenant and reads on
 * the same screens.
 */
async function seedStopBeyondEntry() {
  const prisma = new PrismaClient();
  try {
    const sibling = await prisma.trade.findFirst({
      where: { kind: 'trade' },
      select: { userId: true, mt5AccountId: true },
      orderBy: { openAt: 'desc' },
    });
    if (!sibling) throw new Error('the seeded book has no trades to borrow a tenant from');

    return prisma.trade.create({
      data: {
        ...sibling,
        ticket: `${SYMBOL}-${Date.now()}`,
        kind: 'trade',
        symbol: SYMBOL,
        assetClass: 'forex',
        direction: 'long',
        style: 'day',
        openAt: new Date('2026-07-02T09:00:00.000Z'),
        closeAt: new Date('2026-07-02T15:00:00.000Z'),
        volume: 1,
        entryPrice: 1.1,
        exitPrice: 1.12,
        // Above the entry on a long: the position was already in profit, so nothing was at
        // risk and there is honestly no R to show.
        sl: 1.11,
        commission: 0,
        swap: 0,
        profit: 200,
        risk: null,
        rr: null,
      },
      select: { id: true },
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function removeSeeded() {
  const prisma = new PrismaClient();
  try {
    await prisma.trade.deleteMany({ where: { symbol: SYMBOL } });
  } finally {
    await prisma.$disconnect();
  }
}

/** How many cards to open before giving up looking for one with no R multiple. */
const SEARCH_DEPTH = 25;

test.describe('the trade report', () => {
  test('never contradicts itself about the stop loss, on any card', async ({ page }) => {
    /*
     * The client's bug, stated as the property it broke.
     *
     * Every card is checked rather than one, because the failure was never uniform: the same
     * book had trades that priced correctly beside trades that did not, and which was which
     * depended on whether a symbol's name survived normalisation well enough for the broker's
     * specification endpoint to answer. A test that opened one trade had a two-in-three chance
     * of opening a healthy one and reporting all clear.
     */
    const total = Math.min(await tradeCount(page), SEARCH_DEPTH);
    expect(total, 'the seeded book has no trades to read').toBeGreaterThan(0);

    for (let nth = 0; nth < total; nth++) {
      const card = await openTrade(page, nth);
      const stopLoss = valueOf(card, 'Stop loss');
      expect(stopLoss, `trade ${nth} has no stop-loss row at all`).toBeTruthy();

      if (/had no stop loss/i.test(card)) {
        expect(stopLoss, `trade ${nth} blamed a missing stop loss it is showing on screen`).toBe(
          '—',
        );
      }
    }
  });

  test('names the real reason on a trade that has a stop and no R', async ({ page }) => {
    /*
     * The client's exact case, written into the book rather than hunted for.
     *
     * Looking for one of these in the seeded data meant the test skipped whenever the seed had
     * none, which is to say most of the time — a test that reports success by not running. A
     * stop trailed past the entry is a real trade with a real stop and no R, and it is the case
     * the old screen got most wrong: it printed the stop three rows under a line saying the
     * trade had no stop loss.
     */
    const trade = await seedStopBeyondEntry();
    try {
      await page.goto(`/trades/${trade.id}`);
      const card = await page.locator('main').innerText();

      expect(valueOf(card, 'RR'), 'the seeded trade came out with an R multiple').toBe('—');
      expect(valueOf(card, 'Stop loss'), 'the seeded stop is not on the card').not.toBe('—');

      expect(card, 'the card still blames a stop loss it is showing').not.toMatch(
        /had no stop loss/i,
      );
      // Under the dash, in the three words the tile has room for.
      expect(card, 'the dash under RR is not labelled at all').toMatch(/stop past the entry/i);

      /*
       * And the sentence behind the ⓘ, which is where the reason is actually explained.
       *
       * It lives in a `data-info` attribute until the mark is pressed, so it is absent from the
       * card's text — which is the point of it, and also why asserting on the rendered text
       * alone would have passed a screen whose explanation was never reachable.
       */
      await page.locator('[data-info]').first().click();
      await expect(page.locator('[data-info-panel]')).toContainText(
        /profitable side|nothing at risk/i,
      );
    } finally {
      await removeSeeded();
    }
  });
});
