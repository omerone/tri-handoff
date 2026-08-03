import { expect, test, type Page } from '@playwright/test';

/**
 * The phone sweep.
 *
 * Every rule here was a real defect found by measuring the pages at 375px rather than by
 * looking at them: the trades table was 660 pixels wide inside a 340 pixel scroller, so P&L
 * and RR — the two figures the product exists for — sat off the right edge; the calendar
 * broke `+₪1,165` across two lines and ran it into the next day; a KPI tile split `-₪979,454`
 * after the minus sign, which displays a loss as a gain.
 *
 * These are cheap and they catch the whole class, because the class is always the same: a
 * desktop layout that technically renders at 375px and cannot be read there.
 */

const ROUTES = ['/dashboard', '/analytics', '/trades', '/calendar', '/finance', '/long', '/settings'];

/** True when the page as a whole scrolls sideways — never correct, at any width. */
const scrollsSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

test.describe('on a phone', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) >= 768, 'the desktop project covers the rest');

  for (const route of ROUTES) {
    test(`${route} fits the screen`, async ({ page }) => {
      await page.goto(route);
      await expect(page.locator('main')).toBeVisible();
      expect(await scrollsSideways(page), `${route} scrolls sideways`).toBe(false);

      // A wide table inside its own scroller is fine — that is what the scroller is for.
      // A wide *element* anywhere else has pushed the page out and is the bug.
      const escaped = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        return [...document.querySelectorAll('body *')]
          .filter((el) => {
            const style = getComputedStyle(el);
            if (style.position === 'fixed') return false;
            for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
              const x = getComputedStyle(p).overflowX;
              if (x === 'auto' || x === 'scroll') return false;
            }
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && (r.right > vw + 1 || r.left < -1);
          })
          .slice(0, 3)
          .map((el) => `${el.tagName.toLowerCase()}.${(el.className || '').toString().slice(0, 40)}`);
      });
      expect(escaped, `${route} has elements past the viewport edge`).toEqual([]);
    });
  }

  test('shows the figures a trade is judged on without scrolling sideways', async ({ page }) => {
    // The table is replaced by a list below the tablet breakpoint precisely so that P&L and
    // RR are on screen. If the table comes back, this fails.
    await page.goto('/trades');
    await expect(page.locator('table')).toBeHidden();

    const first = page.locator('[href^="/trades/"]').first();
    await expect(first).toBeVisible();
    await expect(first.getByText(/R$/)).toBeVisible(); // the RR chip
    await expect(first.locator('.tri-num').first()).toBeVisible();

    const within = await first.evaluate((el) => {
      const vw = document.documentElement.clientWidth;
      return [...el.querySelectorAll('*')].every((child) => {
        const r = child.getBoundingClientRect();
        return r.width === 0 || (r.left >= -1 && r.right <= vw + 1);
      });
    });
    expect(within, 'part of a trade row is off-screen').toBe(true);
  });

  test('never breaks a figure across two lines', async ({ page }) => {
    // `-₪979,454` wrapping after the minus leaves a line reading `₪979,454` under a stray
    // dash: a loss displayed as a gain. Every figure in the product goes through `Num`.
    //
    // Asserted as the rule rather than as an observation. The seeded book tops out at five
    // digits, which fits on one line either way — so measuring the rendered boxes here would
    // pass with the guarantee removed, and only start failing on the day a real account
    // produces a number long enough. The rule holds for any data; the measurement below only
    // confirms it is actually reaching the page.
    // Scoped to `main`: the header's TRi mark also carries `tri-num`, for the mono face
    // rather than because it is a number, and it is the first match on the page.
    await page.goto('/dashboard');
    await expect(page.locator('main .tri-num').first()).toHaveCSS('white-space', 'nowrap');

    for (const route of ['/dashboard', '/finance', '/calendar']) {
      await page.goto(route);
      const wrapped = await page.evaluate(() => {
        return [...document.querySelectorAll('main .tri-num')]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            if (r.height === 0) return false;
            const line = parseFloat(getComputedStyle(el).lineHeight) || r.height;
            return r.height > line * 1.6;
          })
          .map((el) => el.textContent?.trim() ?? '')
          .slice(0, 3);
      });
      expect(wrapped, `a figure wrapped on ${route}`).toEqual([]);
    }
  });

  test('keeps the thirty-day panel folded until it is asked for', async ({ page }) => {
    // The strip becomes a row per trading day on a phone, which is most of the screen — so
    // whatever the trader arranged under it starts below the fold. It arrives closed, as one
    // header row carrying the count, and its header is the disclosure. On a desktop the header
    // is plain text and the panel is a compact strip that already fits.
    await page.goto('/dashboard');
    const card = page.locator('[data-widget="rStrip"]');
    const days = card.locator('li');
    const toggle = card.getByRole('button');

    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(days.first()).toBeHidden();

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(days.first()).toBeVisible();

    await toggle.click();
    await expect(days.first()).toBeHidden();
  });

  test('gives its controls a finger-sized target', async ({ page }) => {
    // 24 CSS px is WCAG 2.5.8's floor. The nav links were 32×85 and the header buttons 39×27
    // before the hit areas grew; this asserts the floor rather than the 44 the CSS aims for,
    // so it fails on a real regression rather than on a pixel of padding.
    await page.goto('/dashboard');
    const cramped = await page.evaluate(() => {
      return [...document.querySelectorAll('header a, header button')]
        .map((el) => {
          const r = el.getBoundingClientRect();
          const after = getComputedStyle(el, '::after');
          const grown = after.content !== 'none' ? 44 : 0;
          return {
            label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24),
            h: Math.max(r.height, grown),
            w: Math.max(r.width, grown),
          };
        })
        .filter((el) => el.h > 0 && (el.h < 24 || el.w < 24));
    });
    expect(cramped).toEqual([]);
  });
});

test.describe('on a wide screen', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 768, 'the phone sweep covers the rest');

  test('shows the thirty-day strip, with no fold', async ({ page }) => {
    // The counterpart to the phone's disclosure. Here the panel is the strip, which fits, so
    // there is nothing to fold — and a control that changes nothing is worse than no control.
    //
    // The visible strip is the half that matters: the card starts closed on a phone, and the
    // closed state is a class the wide breakpoint overrides. Get that override wrong and the
    // desktop dashboard shows an empty card with no way to open it.
    await page.goto('/dashboard');
    const card = page.locator('[data-widget="rStrip"]');
    await expect(card.getByText(/^\d{2}\/\d{2}$/).first()).toBeVisible();
    await expect(card.getByRole('button')).toHaveCount(0);
  });
});
