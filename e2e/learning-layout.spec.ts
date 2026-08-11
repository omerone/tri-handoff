import { expect, test } from '@playwright/test';

/**
 * Two things the study screen was getting wrong in the same card.
 */

test.describe('the learning entry row', () => {
  test.skip(({ isMobile }) => !!isMobile, 'two columns on a phone is the intended shape');

  test('keeps every field on one line, with the note below it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/learning');

    const opener = page.getByRole('button', { name: /add an entry|הוספת רשומה/i }).first();
    if (await opener.isVisible().catch(() => false)) await opener.click();

    // Seven controls that used to wrap: the date and the button dropped to a second line
    // with the whole width of the card empty beside them, which reads as two forms.
    // The date is asked for by its label: `name="learnedOn"` is DateField's hidden carrier
    // input, which has no box to measure — the visible control beside it is what wraps or
    // does not.
    const controls = [
      page.locator('[name="topic"]'),
      page.locator('[name="hours"]'),
      page.locator('[name="minutes"]'),
      page.locator('[name="title"]'),
      page.getByLabel(/^date$|^תאריך$/i).first(),
      page.getByRole('button', { name: /^add$|^הוסף$/i }),
    ];
    const tops = await Promise.all(
      controls.map(async (control) => (await control.first().boundingBox())?.y ?? -1),
    );

    expect(tops.every((y) => y >= 0), 'a control is missing from the row').toBe(true);
    // Same line means same top, within the tolerance a label above a field allows.
    expect(Math.max(...tops) - Math.min(...tops), 'the row wrapped').toBeLessThan(8);

    // The note is a sentence, not a field: it keeps its own line on purpose.
    const note = await page.locator('[name="note"]').boundingBox();
    expect(note!.y).toBeGreaterThan(Math.max(...tops));
  });
});

test.describe('the hours-by-topic ring', () => {
  test.skip(({ isMobile }) => !!isMobile, 'hover is a pointer gesture');

  test('does not print its hover card on top of the total', async ({ page }) => {
    await page.goto('/learning?range=max');

    const centre = page.locator('[data-ring="total"]');
    await expect(centre).toHaveCSS('opacity', '1');

    /*
     * A real pointer on the ring's band.
     *
     * `hover()` on the arc aims at the element's centre, and the centre of a ring's bounding
     * box is the hole — no pointer event, no tooltip, and a test that reports the fix broken
     * while it works. So the band is computed: the chart is square, and the band sits between
     * the inner and outer radius, which is comfortably 20px in from the top edge.
     */
    const chart = page.locator('.recharts-wrapper').first();
    const box = await chart.boundingBox();
    if (!box) test.skip(true, 'no ring drawn in this range');
    await page.mouse.move(box!.x + box!.width / 2, box!.y + 20);

    // Hovering used to draw the card at the pointer — over the hole the total lives in, so
    // three runs of text shared one space and none could be read.
    await expect(centre, 'the total is still drawn under the hover card').toHaveCSS(
      'opacity',
      '0',
    );

    // And it comes back the instant the pointer leaves.
    await page.mouse.move(box!.x - 40, box!.y - 40);
    await expect(centre).toHaveCSS('opacity', '1');
  });
});
