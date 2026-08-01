/**
 * Design tokens, mirrored from src/app/globals.css.
 *
 * Components should prefer the Tailwind classes (`bg-surface`, `text-dim`, …). This module
 * exists for the places that need a value in JS: SVG props in Recharts, and the heatmap /
 * R-strip which interpolate alpha at runtime.
 *
 * `TOKEN` gives the `var(--tri-*)` reference (theme-aware, use wherever CSS is accepted).
 * `RGB` gives the raw channels for building `rgba()` at a computed alpha.
 */

export const TOKEN = {
  bg: 'var(--tri-bg)',
  surface: 'var(--tri-surface)',
  raised: 'var(--tri-raised)',
  line: 'var(--tri-line)',
  text: 'var(--tri-text)',
  dim: 'var(--tri-dim)',
  brand: 'var(--tri-brand)',
  brand2: 'var(--tri-brand-2)',
  pos: 'var(--tri-pos)',
  neg: 'var(--tri-neg)',
  warn: 'var(--tri-warn)',
} as const;

export const RGB = {
  bg: [10, 11, 15],
  pos: [45, 212, 167],
  neg: [255, 92, 122],
  brand: [91, 140, 255],
} as const satisfies Record<string, readonly [number, number, number]>;

export function rgba(channels: readonly [number, number, number], alpha: number): string {
  const [r, g, b] = channels;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Tone → token, used by KPI tiles and any figure that is coloured by sign. */
export function toneColor(tone: 'pos' | 'neg' | 'neutral'): string {
  if (tone === 'pos') return TOKEN.pos;
  if (tone === 'neg') return TOKEN.neg;
  return TOKEN.text;
}

export function signTone(value: number): 'pos' | 'neg' {
  return value >= 0 ? 'pos' : 'neg';
}
