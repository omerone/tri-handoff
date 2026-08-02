/**
 * The dashboard layout the user builds for themselves (SPEC §1.1: "דשבורד מבוסס כרטיסים
 * בגריד שניתן לגרור ולשנות גודל — המשתמש בונה את הפריסה שלו").
 *
 * A layout is an ordered list of widgets, each with a width in columns of a 12-column grid.
 * That is the whole model: no free x/y placement, no row spans. A 12-column flow grid is
 * what makes the layout survive a narrower window — the same list re-flows at 6 and at 1
 * column without the user's arrangement turning into overlapping boxes or a hole in the
 * middle of the page, which is exactly what a free-placement grid does when it is asked to
 * render at 375px.
 *
 * Height is left to the content. A KPI tile is one line of text; forcing it to fill a row
 * the user dragged taller would only add whitespace, and letting the user shrink the equity
 * chart below its axis labels would produce a chart nobody can read.
 *
 * Everything here is pure so the rules can be tested without a browser or a database.
 */

export type WidgetKind = 'kpi' | 'panel';

/** The column widths a widget may take. A ladder, not a range, so nothing lands off-grid. */
export const SPANS = [2, 3, 4, 6, 8, 12] as const;
export type Span = (typeof SPANS)[number];

export const COLUMNS = 12;

/**
 * Every widget the dashboard can show, in the order the prototype lays them out.
 *
 * `kind` drives the fallback width on narrow screens, where the user's chosen span is not
 * used at all: a KPI tile goes two-up on a phone and three-up on a tablet, a panel goes full
 * width. Below the desktop breakpoint the layout is the app's business, not the user's —
 * there is no room for a choice, and a 2-column tile the user set would be unreadable.
 */
export const WIDGETS = {
  balance: { kind: 'kpi', span: 2 },
  netPnl: { kind: 'kpi', span: 2 },
  winRate: { kind: 'kpi', span: 2 },
  avgRr: { kind: 'kpi', span: 2 },
  profitFactor: { kind: 'kpi', span: 2 },
  maxDd: { kind: 'kpi', span: 2 },
  rStrip: { kind: 'panel', span: 12 },
  equity: { kind: 'panel', span: 8 },
  recent: { kind: 'panel', span: 4 },
} as const satisfies Record<string, { kind: WidgetKind; span: Span }>;

export type WidgetId = keyof typeof WIDGETS;

export const WIDGET_IDS = Object.keys(WIDGETS) as WidgetId[];

export function isWidgetId(value: unknown): value is WidgetId {
  return typeof value === 'string' && Object.hasOwn(WIDGETS, value);
}

/**
 * The widths used on screens too narrow to honour a chosen span, in columns of the same
 * 12-column grid.
 *
 * Here rather than in the component because these are the other two thirds of the layout
 * rule and they deserve the same tests: a panel that quietly drops to half width on a tablet
 * puts the equity chart's axis labels on top of each other, and nothing about that is
 * visible from the desktop breakpoint the rest of the suite renders at.
 */
export const NARROW_SPAN = {
  kpi: { base: 6, md: 4 },
  panel: { base: 12, md: 12 },
} as const satisfies Record<WidgetKind, { base: number; md: number }>;

export type LayoutItem = { readonly id: WidgetId; readonly span: Span };

/** How much of a stored list is worth reading. See `normalizeLayout`. */
const MAX_STORED_ENTRIES = 64;

export const DEFAULT_LAYOUT: readonly LayoutItem[] = WIDGET_IDS.map((id) => ({
  id,
  span: WIDGETS[id].span,
}));

/** Snaps any number onto the span ladder. Ties go to the wider option. */
export function snapSpan(value: unknown): Span | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  let best: Span = SPANS[0];
  for (const span of SPANS) {
    if (Math.abs(span - value) <= Math.abs(best - value)) best = span;
  }
  return best;
}

/**
 * Turns whatever is in the database into a layout that renders.
 *
 * This is the only way a layout enters the app, and it is deliberately total: any shape at
 * all produces a usable dashboard. That matters more than it looks. The stored value is JSON
 * written by an earlier version of this file, so it is the one input that is both untrusted
 * *and* guaranteed to go stale — a widget renamed or removed in a later release would
 * otherwise leave every existing user with a dashboard that throws.
 *
 * Unknown ids are dropped, duplicates keep their first position, spans are snapped onto the
 * ladder, and widgets missing from the stored list are appended in default order. Appending
 * rather than restoring them to their default index is on purpose: a widget added in a later
 * release should show up somewhere obvious without reshuffling an arrangement the user built.
 */
export function normalizeLayout(raw: unknown): LayoutItem[] {
  if (!Array.isArray(raw)) return [...DEFAULT_LAYOUT];

  const seen = new Set<WidgetId>();
  const layout: LayoutItem[] = [];

  // The whitelist and the dedupe already bound the *output* at one entry per widget, but the
  // input is a browser-supplied array and nothing bounds how long it is. Capping the scan
  // makes that bound explicit instead of emergent — a list longer than the widget registry
  // cannot contain anything this function would keep.
  for (const entry of raw.slice(0, MAX_STORED_ENTRIES)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { id, span } = entry as { id?: unknown; span?: unknown };
    if (!isWidgetId(id) || seen.has(id)) continue;
    seen.add(id);
    layout.push({ id, span: snapSpan(span) ?? WIDGETS[id].span });
  }

  for (const id of WIDGET_IDS) {
    if (!seen.has(id)) layout.push({ id, span: WIDGETS[id].span });
  }

  return layout;
}

/** True when the layout is the default one, so the UI can hide "reset". */
export function isDefaultLayout(layout: readonly LayoutItem[]): boolean {
  return (
    layout.length === DEFAULT_LAYOUT.length &&
    layout.every((item, index) => {
      const fallback = DEFAULT_LAYOUT[index];
      return fallback !== undefined && item.id === fallback.id && item.span === fallback.span;
    })
  );
}

/**
 * Moves a widget to an absolute position. Used by the drag; the index is clamped.
 *
 * A move that changes nothing returns the layout it was given, by identity. Callers use that
 * identity to decide whether anything is worth saving — without it, holding the arrow key
 * against the end of the grid writes the same arrangement to the database over and over and
 * tells the user it saved something.
 */
export function reorderWidget(
  layout: readonly LayoutItem[],
  id: WidgetId,
  toIndex: number,
): readonly LayoutItem[] {
  const from = layout.findIndex((item) => item.id === id);
  const moved = layout[from];
  // `Math.trunc(NaN)` is `NaN`, which survives both clamps and then reads as 0 inside
  // `splice` — a bad index would quietly move the card to the front rather than do nothing.
  if (from === -1 || moved === undefined || !Number.isFinite(toIndex)) return layout;

  const to = Math.max(0, Math.min(layout.length - 1, Math.trunc(toIndex)));
  if (to === from) return layout;

  const next = [...layout];
  next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Moves a widget by a number of positions. Used by the keyboard. */
export function moveWidget(
  layout: readonly LayoutItem[],
  id: WidgetId,
  delta: number,
): readonly LayoutItem[] {
  const from = layout.findIndex((item) => item.id === id);
  return from === -1 ? layout : reorderWidget(layout, id, from + delta);
}

/** Widens (`+1`) or narrows (`-1`) a widget by one rung of the ladder. */
export function resizeWidget(
  layout: readonly LayoutItem[],
  id: WidgetId,
  direction: 1 | -1,
): readonly LayoutItem[] {
  const rung = SPANS.indexOf(layout.find((item) => item.id === id)?.span ?? (-1 as Span));
  // An off-ladder span would make `indexOf` return -1, and -1 + direction lands back on the
  // ladder at either end — a silent wrong answer. `normalizeLayout` means it cannot happen;
  // refusing rather than guessing means a future path that breaks that stays visible.
  if (rung === -1) return layout;

  const next = SPANS[Math.max(0, Math.min(SPANS.length - 1, rung + direction))];
  // Same identity when the span did not actually change — at either end of the ladder — for
  // the same reason `reorderWidget` does it: it is what tells the grid there is nothing to
  // save. `canResize` already disables the button there, so this only matters to a caller
  // that does not ask first.
  if (next === undefined || next === SPANS[rung]) return layout;

  return layout.map((item) => (item.id === id ? { ...item, span: next } : item));
}

export function canResize(span: Span, direction: 1 | -1): boolean {
  const rung = SPANS.indexOf(span);
  return direction === 1 ? rung < SPANS.length - 1 : rung > 0;
}
