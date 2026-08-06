import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  canResize,
  COLUMNS,
  DEFAULT_LAYOUT,
  isDefaultLayout,
  moveWidget,
  normalizeLayout,
  reorderWidget,
  resizeWidget,
  NARROW_SPAN,
  snapSpan,
  SPANS,
  WIDGET_IDS,
  WIDGETS,
  type LayoutItem,
} from './layout';

const ids = (layout: readonly LayoutItem[]): string[] => layout.map((item) => item.id);

describe('the default layout', () => {
  it('holds every widget exactly once', () => {
    expect(ids(DEFAULT_LAYOUT).sort()).toEqual([...WIDGET_IDS].sort());
    expect(isDefaultLayout(DEFAULT_LAYOUT)).toBe(true);
  });

  it('fills whole rows, so the prototype grid has no ragged edge', () => {
    // Flowed into a 12-column grid the way CSS will flow it: no row overflows, and the last
    // one is not left half-empty. Stated as the invariant rather than as fixed slices, so a
    // widget added later gets checked instead of shifting the indices out from under the test.
    let row = 0;
    for (const item of DEFAULT_LAYOUT) {
      row = row + item.span > COLUMNS ? item.span : row + item.span;
      expect(row).toBeLessThanOrEqual(COLUMNS);
    }
    expect(row).toBe(COLUMNS);
  });
});

describe('normalizeLayout', () => {
  it('falls back to the default for anything that is not a list', () => {
    for (const raw of [null, undefined, 42, 'x', {}, { id: 'balance' }]) {
      expect(normalizeLayout(raw)).toEqual(DEFAULT_LAYOUT);
    }
  });

  it('keeps a stored order and span', () => {
    const stored = [
      { id: 'equity', span: 12 },
      { id: 'balance', span: 4 },
    ];
    const layout = normalizeLayout(stored);
    expect(layout.slice(0, 2)).toEqual(stored);
  });

  it('appends widgets the stored layout never heard of', () => {
    // The case this really guards: a release adds a widget, and every existing user has a
    // layout written before it existed.
    const layout = normalizeLayout([{ id: 'recent', span: 6 }]);
    expect(ids(layout)[0]).toBe('recent');
    expect(ids(layout).sort()).toEqual([...WIDGET_IDS].sort());
  });

  it('drops ids that are no longer widgets, rather than rendering nothing', () => {
    const layout = normalizeLayout([{ id: 'a-widget-we-removed', span: 4 }, { id: 'equity' }]);
    expect(ids(layout)).not.toContain('a-widget-we-removed');
    expect(ids(layout)[0]).toBe('equity');
    expect(layout).toHaveLength(WIDGET_IDS.length);
  });

  it('keeps the first of a duplicated widget and no more', () => {
    const layout = normalizeLayout([
      { id: 'equity', span: 12 },
      { id: 'equity', span: 2 },
    ]);
    expect(layout.filter((item) => item.id === 'equity')).toEqual([{ id: 'equity', span: 12 }]);
  });

  it('snaps a hostile span onto the ladder instead of emitting it', () => {
    // A span is written straight into a CSS grid-column, so "999" or "-1" reaching the page
    // is a layout that breaks for everyone who loads it.
    const layout = normalizeLayout([
      { id: 'balance', span: 999 },
      { id: 'netPnl', span: -4 },
      { id: 'winRate', span: 5 },
      { id: 'avgRr', span: '8' },
      { id: 'profitFactor', span: Number.NaN },
    ]);
    const span = (id: string) => layout.find((item) => item.id === id)?.span;
    expect(span('balance')).toBe(12);
    expect(span('netPnl')).toBe(2);
    expect(span('winRate')).toBe(6); // ties widen
    expect(span('avgRr')).toBe(WIDGETS.avgRr.span); // a string is not a span
    expect(span('profitFactor')).toBe(WIDGETS.profitFactor.span);
    for (const item of layout) expect(SPANS).toContain(item.span);
  });

  it('is idempotent, so a round-trip through the database changes nothing', () => {
    const once = normalizeLayout([{ id: 'recent', span: 7 }, { id: 'nope' }]);
    expect(normalizeLayout(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });
});

describe('snapSpan', () => {
  it('returns null for values that are not numbers', () => {
    for (const raw of ['4', null, undefined, {}, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(snapSpan(raw)).toBeNull();
    }
  });

  it('leaves values already on the ladder alone', () => {
    for (const span of SPANS) expect(snapSpan(span)).toBe(span);
  });
});

describe('moving', () => {
  const layout = DEFAULT_LAYOUT;
  /*
   * The ends by position, not by name. These used to name `balance` and `recent`, which meant
   * adding a widget to the registry broke a test about clamping — the assertion is "the last
   * one cannot move down", and which widget is last is the registry's business.
   */
  const firstId = layout[0]!.id;
  const lastId = layout[layout.length - 1]!.id;

  it('moves a widget to an absolute index', () => {
    expect(ids(reorderWidget(layout, 'recent', 0))[0]).toBe('recent');
    expect(ids(reorderWidget(layout, 'balance', 99)).at(-1)).toBe('balance');
  });

  it('clamps at the ends instead of wrapping around', () => {
    // Holding the left arrow on the first widget should stop, not send it to the bottom.
    expect(moveWidget(layout, firstId, -1)).toEqual([...layout]);
    expect(moveWidget(layout, lastId, 1)).toEqual([...layout]);
  });

  it('never loses or duplicates a widget', () => {
    for (const delta of [-3, -1, 1, 4]) {
      for (const id of WIDGET_IDS) {
        const moved = moveWidget(layout, id, delta);
        expect(ids(moved).sort()).toEqual([...WIDGET_IDS].sort());
        expect(moved).toHaveLength(layout.length);
      }
    }
  });

  it('leaves the layout alone for a widget that is not in it', () => {
    const partial: LayoutItem[] = [{ id: 'equity', span: 8 }];
    expect(moveWidget(partial, 'recent', 1)).toEqual(partial);
  });

  it('refuses an index that is not a number instead of guessing zero', () => {
    // `Math.trunc(NaN)` is `NaN`, it survives both clamps, and `splice(NaN, …)` reads it as
    // 0 — so a bad index moves the card to the *front* while looking like a no-op guard.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(reorderWidget(layout, 'recent', bad)).toBe(layout);
    }
  });

  it('returns the very same array when nothing moved', () => {
    // Identity, not equality: it is what tells the grid there is nothing to save. Without it,
    // an arrow key held against the end of the row re-saves an identical arrangement on every
    // repeat and announces each one.
    expect(moveWidget(layout, firstId, -1)).toBe(layout);
    expect(moveWidget(layout, lastId, 1)).toBe(layout);
    expect(reorderWidget(layout, firstId, 0)).toBe(layout);
    expect(resizeWidget(layout, 'rStrip', 1)).toBe(layout); // already at the top rung
    expect(resizeWidget(layout, 'balance', -1)).toBe(layout); // already at the bottom rung
  });
});

describe('resizing', () => {
  it('steps one rung at a time and stops at the ends', () => {
    let layout: readonly LayoutItem[] = [{ id: 'equity', span: 8 }];
    layout = resizeWidget(layout, 'equity', 1);
    expect(layout[0]?.span).toBe(12);
    layout = resizeWidget(layout, 'equity', 1);
    expect(layout[0]?.span).toBe(12);
    expect(canResize(12, 1)).toBe(false);
    expect(canResize(12, -1)).toBe(true);

    layout = [{ id: 'equity', span: 2 }];
    expect(resizeWidget(layout, 'equity', -1)[0]?.span).toBe(2);
    expect(canResize(2, -1)).toBe(false);
  });

  it('touches only the widget asked for', () => {
    const resized = resizeWidget(DEFAULT_LAYOUT, 'balance', 1);
    expect(resized.filter((item, i) => item.span !== DEFAULT_LAYOUT[i]?.span)).toHaveLength(1);
  });
});

describe('isDefaultLayout', () => {
  it('is false once anything moves or changes width', () => {
    expect(isDefaultLayout(moveWidget(DEFAULT_LAYOUT, 'recent', -1))).toBe(false);
    expect(isDefaultLayout(resizeWidget(DEFAULT_LAYOUT, 'balance', 1))).toBe(false);
    expect(isDefaultLayout(DEFAULT_LAYOUT.slice(1))).toBe(false);
  });
});

/** Deterministic, so a failure here is reproducible rather than a mystery in CI. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('normalizeLayout is total', () => {
  const HOSTILE_IDS = [
    ...WIDGET_IDS,
    'a-widget-we-removed',
    '',
    'toString',
    'constructor',
    '__proto__',
    'hasOwnProperty',
    42,
    null,
    { id: 'balance' },
  ];

  const HOSTILE_SPANS = [
    ...SPANS, 0, 1, 5, 7, -4, 999, 1e309, '8', null, undefined, Number.NaN, {},
  ];

  it('returns every widget exactly once, on the ladder, whatever it is handed', () => {
    // The cases above pin one rule each. This pins the promise the whole function makes —
    // that there is no input at all for which the dashboard renders short, doubled, or with a
    // span that is not a grid column. Nothing downstream checks again.
    const random = rng(20260801);
    const pick = <T,>(values: readonly T[]): T => values[Math.floor(random() * values.length)]!;

    for (let run = 0; run < 500; run += 1) {
      const raw = Array.from({ length: Math.floor(random() * 14) }, () =>
        random() < 0.15
          ? pick([null, 'balance', 7, [], undefined])
          : { id: pick(HOSTILE_IDS), span: pick(HOSTILE_SPANS) },
      );

      const layout = normalizeLayout(raw);
      expect(ids(layout).sort(), JSON.stringify(raw)).toEqual([...WIDGET_IDS].sort());
      for (const item of layout) expect(SPANS, JSON.stringify(raw)).toContain(item.span);
      expect(normalizeLayout(JSON.parse(JSON.stringify(layout)))).toEqual(layout);
    }
  });

  it('accepts only the ids the registry owns, not the ones every object has', () => {
    // `Object.hasOwn`, not `in`. With `in`, "toString" is a widget id, `WIDGETS.toString` has
    // no `span` and no `kind`, and the grid dereferences the missing kind while rendering —
    // so the dashboard throws for whoever's stored layout happens to contain it.
    expect(
      normalizeLayout([
        { id: 'toString', span: 4 },
        { id: 'constructor', span: 4 },
        { id: 'hasOwnProperty', span: 4 },
        { id: '__proto__', span: 4 },
      ]),
    ).toEqual([...DEFAULT_LAYOUT]);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('ignores a stored list far longer than there are widgets', () => {
    const layout = normalizeLayout(
      Array.from({ length: 100_000 }, () => ({ id: 'equity', span: 2 })),
    );
    expect(layout).toHaveLength(WIDGET_IDS.length);
  });
});

describe('the widths used where a chosen span is not', () => {
  it('keeps every kind on the grid at both narrow tiers', () => {
    for (const [kind, widths] of Object.entries(NARROW_SPAN)) {
      for (const [tier, span] of Object.entries(widths)) {
        expect(COLUMNS % span, `${kind}.${tier} does not divide the grid`).toBe(0);
      }
    }
    // Two-up on a phone, three-up on a tablet, panels full width at both. A panel dropping to
    // half width at 768px is the regression this exists to catch: it puts the equity chart's
    // axis labels on top of each other at a width nothing else in the suite renders at.
    expect(NARROW_SPAN.kpi).toEqual({ base: 6, md: 4 });
    expect(NARROW_SPAN.panel).toEqual({ base: 12, md: 12 });
  });

  it('is wired to the custom properties the stylesheet actually reads', () => {
    // The component writes `--tri-span-base` / `--tri-span-md` / `--tri-span`; the stylesheet
    // reads them at three breakpoints. Rename one side and the widget silently falls back to
    // `grid-column: auto` at that tier, which no type checks and no test would otherwise see.
    const css = readFileSync('src/app/globals.css', 'utf8');
    const grid = readFileSync('src/app/(app)/dashboard/grid.tsx', 'utf8');
    for (const property of ['--tri-span-base', '--tri-span-md', '--tri-span']) {
      expect(css, `${property} missing from globals.css`).toContain(`var(${property})`);
      expect(grid, `${property} missing from grid.tsx`).toContain(`'${property}'`);
    }
    expect(css).toContain('@media (min-width: 768px)');
    expect(css).toContain('@media (min-width: 1024px)');
  });
});
