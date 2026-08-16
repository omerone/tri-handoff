/**
 * The sentence that stands in for a picture.
 *
 * A chart's accessible name says *what* it is; this says what it currently shows — the thing a
 * sighted reader takes from a glance and a list of forty rows does not give back. "Twelve
 * categories, the largest is Food at 38%" is the glance. The table underneath, where there is
 * one, is the detail.
 *
 * Pure, and it takes what the legend already prints rather than raw numbers. The captions in a
 * legend have been through the display currency, the locale and the rounding; recomputing them
 * here from the values would produce a summary that disagrees with the chart beside it in the
 * fourth decimal place, on exactly the screens where that matters most.
 */

/**
 * One end of a chart, as a phrase.
 *
 * The caption is dropped when it carries nothing — an untraded weekday's is a dash, and
 * "Highest: Monday · —" spends four characters saying there is no figure. The label alone is
 * the honest version of that sentence.
 */
export function phrase(part: { label: string; caption: string } | null): string {
  if (part === null) return '';
  const caption = part.caption.trim();
  const empty = caption === '' || caption === '—' || caption === '-';
  return empty ? part.label : `${part.label} · ${caption}`;
}

export type Described = {
  count: number;
  /** The extremes, already formatted. Null when there is nothing to describe. */
  top: { label: string; caption: string } | null;
  bottom: { label: string; caption: string } | null;
};

/**
 * A ring: how many parts, and the biggest one.
 *
 * Only parts with something in them. A donut drawn from ten categories where seven are zero is
 * a three-part ring, and calling it ten would describe a picture nobody is looking at.
 */
export function describeShare(
  slices: readonly { label: string; value: number; caption: string }[],
): Described {
  const drawable = slices.filter((slice) => slice.value > 0);
  if (drawable.length === 0) return { count: 0, top: null, bottom: null };

  const sorted = [...drawable].sort((a, b) => b.value - a.value);
  const first = sorted[0]!;
  return {
    count: drawable.length,
    top: { label: first.label, caption: first.caption },
    bottom: null,
  };
}

/**
 * Bars: how many, the highest and the lowest.
 *
 * Both ends, because a bar chart is read as a comparison and the comparison is between them.
 * A single bar has no spread, so it reports one end and leaves the other null rather than
 * naming the same bar twice.
 */
export function describeSpread(
  bars: readonly { label: string; net: number; caption: string }[],
): Described {
  if (bars.length === 0) return { count: 0, top: null, bottom: null };

  const sorted = [...bars].sort((a, b) => b.net - a.net);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;

  return {
    count: bars.length,
    top: { label: first.label, caption: first.caption },
    bottom: sorted.length > 1 ? { label: last.label, caption: last.caption } : null,
  };
}
