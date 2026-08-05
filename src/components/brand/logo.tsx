/**
 * The TRi mark.
 *
 * It used to be the three letters set in the mono face inside a gradient square, which is a
 * placeholder rather than a logo: at 36px the middle letter is four pixels wide, and the mark
 * only repeats the wordmark standing next to it.
 *
 * What is drawn instead is three ascending bars — Trade, Risk, Insight, the three the name is
 * made of — where the tallest one is not just a bar: the gap and the dot above it make it the
 * lowercase `i` of TRi. So the mark is a chart and a letter at once, and it is still legible
 * at 16px, which a trio of letters is not.
 *
 * The bars fade back as they shorten, which puts the reading order where the eye already goes.
 *
 * The gradient reads the theme's brand variables rather than fixed hex, so the mark follows
 * light and dark the way every other brand surface does. `src/app/icon.svg` is the same
 * drawing with the dark-theme colours baked in — a static file cannot see a CSS variable.
 */
export function TriMark({ size = 36, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="TRi"
    >
      <defs>
        <linearGradient id="tri-mark-fill" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: 'var(--tri-brand)' }} />
          <stop offset="1" style={{ stopColor: 'var(--tri-brand-2)' }} />
        </linearGradient>
        {/* A light source at the top-left corner, so the tile reads as a surface and not a
            flat swatch. Fades out by the middle — below that the gradient carries it. */}
        <linearGradient id="tri-mark-sheen" x1="0" y1="0" x2="0" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity="0.22" />
          <stop offset="0.55" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>

      <rect width="48" height="48" rx="14" fill="url(#tri-mark-fill)" />
      <rect width="48" height="48" rx="14" fill="url(#tri-mark-sheen)" />
      {/* Inset hairline: keeps the tile's edge from disappearing into a light background. */}
      <rect
        x="0.75"
        y="0.75"
        width="46.5"
        height="46.5"
        rx="13.25"
        fill="none"
        stroke="#fff"
        strokeOpacity="0.18"
        strokeWidth="1.5"
      />

      {/* Three bars on one baseline, six units apart in height, `rx` half the width so the
          tops are caps rather than corners. */}
      <rect x="10" y="29" width="5.5" height="11" rx="2.75" fill="#fff" fillOpacity="0.5" />
      <rect x="21.25" y="23" width="5.5" height="17" rx="2.75" fill="#fff" fillOpacity="0.75" />
      <rect x="32.5" y="17" width="5.5" height="23" rx="2.75" fill="#fff" />
      {/* The tittle. Its gap from the bar below is what turns the tallest bar into a letter. */}
      <circle cx="35.25" cy="11" r="3" fill="#fff" />
    </svg>
  );
}
