import { expect, test, type Page } from '@playwright/test';

/**
 * Arranging the table, and the two ways in.
 *
 * The headings are the control a mouse looks for and the only one a table needs. Below the
 * tablet breakpoint there is no table — the rows are cards — so the same ordering is a
 * dropdown there, writing the same two search params. Both are asserted, because a second
 * control for one piece of state is exactly the shape that drifts.
 *
 * What the ordering has to get right beyond ordering: a row with no R is not the worst R in
 * the book. Nulls sort last in *both* directions, so asking for the smallest R does not bury
 * the answer under every row that has none.
 */

/** The values under a named column, in the order the page is showing them. */
async function column(page: Page, heading: string): Promise<string[]> {
  const index = await page
    .locator('thead th')
    .evaluateAll((cells, name) => cells.findIndex((c) => c.textContent?.trim() === name), heading);
  expect(index, `the table has no "${heading}" column`).toBeGreaterThanOrEqual(0);
  return page.locator(`tbody tr td:nth-child(${index + 1})`).allInnerTexts();
}

/** "+₪1,234" / "-₪67" → a number. Dashes come back as null. */
const money = (text: string): number | null => {
  const clean = text.replace(/[^\d.-]/g, '');
  return clean === '' || clean === '-' ? null : Number(clean);
};

test.describe('arranging the trades table', () => {
  test.skip(({ isMobile }) => !!isMobile, 'the headings are the desktop control');

  test('opens newest first, with no sort in the URL', async ({ page }) => {
    await page.goto('/trades?range=max');
    expect(new URL(page.url()).searchParams.get('sort'), 'the default was written out').toBeNull();

    const dates = await column(page, 'Closed');
    const asDate = (text: string) => {
      const [d, m, y] = text.split('·')[0]!.trim().split('/');
      return `${y}${m}${d}`;
    };
    const order = dates.map(asDate);
    expect([...order].sort().reverse(), 'the table did not open newest first').toEqual(order);
  });

  test('sorts by P&L from the heading, and reverses on a second press', async ({ page }) => {
    await page.goto('/trades?range=max');
    const heading = page.getByRole('button', { name: /^P&L/ });

    await heading.click();
    await expect(page).toHaveURL(/sort=profit&order=desc/);
    const high = (await column(page, 'P&L')).map(money).filter((v): v is number => v !== null);
    expect(high.length, 'no figures to compare').toBeGreaterThan(1);
    expect(
      [...high].sort((a, b) => b - a),
      'largest-first is not sorted',
    ).toEqual(high);

    await heading.click();
    await expect(page).toHaveURL(/sort=profit&order=asc/);
    const low = (await column(page, 'P&L')).map(money).filter((v): v is number => v !== null);
    expect(
      [...low].sort((a, b) => a - b),
      'smallest-first is not sorted',
    ).toEqual(low);
    expect(low[0], 'reversing changed nothing').not.toBe(high[0]);
  });

  test('puts the rows with no R last, whichever way R is sorted', async ({ page }) => {
    /*
     * The property worth writing down. A dash is not a small number: sorting by "lowest R"
     * with nulls treated as zero — or worse, as negative infinity — fills the top of the page
     * with the trades that cannot answer the question, and the trader has to scroll past all
     * of them to reach their worst actual trade.
     */
    for (const order of ['desc', 'asc'] as const) {
      await page.goto(`/trades?range=max&sort=rr&order=${order}`);
      const cells = await column(page, 'RR');
      const firstDash = cells.findIndex((text) => text.trim() === '—');
      if (firstDash === -1) continue; // no unpriced rows on this page

      const afterDash = cells.slice(firstDash);
      expect(
        afterDash.every((text) => text.trim() === '—'),
        `a row with an R sits below a row without one, sorted ${order}`,
      ).toBe(true);
    }
  });

  test('keeps the arrangement in the URL, so it survives a reload', async ({ page }) => {
    // The reason it is a search param and not component state: this is a view worth sending
    // to someone, and the back button should undo the arranging.
    await page.goto('/trades?range=max&sort=risk&order=desc');
    const before = await column(page, 'Risk');
    await page.reload();
    expect(await column(page, 'Risk')).toEqual(before);
  });
});

test.describe('narrowing by who entered the row', () => {
  test.skip(({ isMobile }) => !!isMobile, 'one viewport is enough for a predicate');

  test("shows only the broker's rows, or only the trader's", async ({ page }) => {
    /*
     * The badge in the table answers this one row at a time; the dropdown answers it for the
     * book. Holdings are always the trader's own, so narrowing to the broker's drops every one
     * of them — which is the honest answer rather than an omission, and is asserted here so it
     * stays deliberate.
     */
    await page.goto('/trades?range=max&source=mt5');
    const broker = await page
      .locator('tbody tr [data-source]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-source')));
    expect(broker.length, 'nothing matched the broker filter').toBeGreaterThan(0);
    expect([...new Set(broker)]).toEqual(['mt5']);

    await page.goto('/trades?range=max&source=manual');
    const typed = await page
      .locator('tbody tr [data-source]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-source')));
    expect(typed.length, 'nothing matched the manual filter').toBeGreaterThan(0);
    expect([...new Set(typed)]).toEqual(['manual']);

    /*
     * And the two halves add back up to the whole, so the filter partitions the book rather
     * than dropping rows out of it.
     *
     * Counted from the summary bar, not from the rows on screen: the bar reports the filter
     * and the table reports one page of forty, so an unfiltered book of ninety-three compares
     * as 40 against two halves that both fit on a page. That is the same reading error the
     * summary exists to prevent, met from the test's side.
     */
    const deals = async (query: string) => {
      await page.goto(`/trades?range=max${query}`);
      const text = await page.locator('main').innerText();
      return Number(/(\d+)\s+trades?/.exec(text)![1]);
    };
    const [mt5, manual, everything] = [
      await deals('&source=mt5'),
      await deals('&source=manual'),
      await deals(''),
    ];
    expect(mt5 + manual, 'the two sources do not add up to the book').toBe(everything);
  });
});

test.describe('arranging on a phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'the dropdown is the phone control');

  test('offers the ordering the headings would, and applies it', async ({ page }) => {
    await page.goto('/trades?range=max');

    const sort = page.locator('select').filter({ hasText: 'Newest first' });
    await expect(sort, 'no sort control on the phone layout').toBeVisible();

    await sort.selectOption('profit:desc');
    await expect(page).toHaveURL(/sort=profit&order=desc/);

    // The cards carry the figure; the first should be the largest in the book.
    const figures = await page
      .locator('main ul > li')
      .filter({ visible: true })
      .evaluateAll((cards) =>
        cards
          .map((card) => (card.textContent ?? '').match(/[+-]₪[\d,]+/)?.[0] ?? '')
          .filter(Boolean)
          .map((text) => Number(text.replace(/[^\d.-]/g, ''))),
      );
    expect(figures.length, 'no figures on the cards').toBeGreaterThan(1);
    expect(
      [...figures].sort((a, b) => b - a),
      'the cards are not in order',
    ).toEqual(figures);
  });
});
