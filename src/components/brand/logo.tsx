/**
 * The TRO mark: a rising line with an arrow, inside its own frame.
 *
 * Four days and a breakout, plotted on a grid — the picture the product is about, drawn the
 * way the dashboard draws it: the run is not a clean ascent, it dips twice on the way, and the
 * arrow only leaves at the end. A mark showing an unbroken climb would be the one thing a
 * trading journal must never claim.
 *
 * The geometry here and in `src/app/icon.svg` is the same drawing, and the two are kept in
 * step by hand: a favicon has no page to read a CSS variable from, so that file bakes the teal
 * in and carries a dark tile the browser's tab strip cannot supply. `scripts/render-icons.mjs`
 * turns that file into the PNGs iOS and Android need, so a change made here has to be made
 * there and re-rendered — three copies, and this comment is the only thing holding them
 * together.
 *
 * Colour comes from the theme's own token rather than frozen hex, so the mark follows light
 * and dark. The glow is a `drop-shadow` on the element instead of an SVG filter: a filter
 * needs an `id`, this renders in two places on the same page — the app header and the sign-in
 * screen — and two elements sharing an id is markup that happens to work rather than markup
 * that is right.
 *
 * At 16px it is a teal smudge with a hint of a climb in it. That is the trade this artwork
 * makes and it is a real one: the mark it replaced was drawn to survive a browser tab and this
 * one is not. Everywhere it is actually looked at — a home screen, a header, a sign-in card —
 * it is unmistakable, and a favicon is the one place nobody is looking.
 */
export function TriMark({ size = 36, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="TRO"
      style={{
        filter: 'drop-shadow(0 0 2px color-mix(in oklab, var(--tri-brand) 55%, transparent))',
      }}
    >
      {/* The frame. Inset far enough that the glow has somewhere to go. */}
      <rect
        x="3.4"
        y="3.4"
        width="41.2"
        height="41.2"
        rx="9.5"
        fill="none"
        stroke="var(--tri-brand)"
        strokeOpacity="0.85"
        strokeWidth="0.9"
      />

      {/* The paper: a baseline and three verticals, kept well under the line so they read as a
          grid rather than as more data. */}
      <g stroke="var(--tri-brand)" strokeOpacity="0.28" strokeWidth="0.45" strokeLinecap="round">
        <path d="M7 37.4H41" />
        <path d="M12.4 8.6V37.4M24 8.6V37.4M35.6 8.6V37.4" />
      </g>

      {/* Round joins, because at this size a mitre on a 130° turn grows a spike longer than the
          stroke is wide. */}
      <path
        d="M6.7 34.6 12.2 22.8 15.6 29.3 20.9 19 28.1 30.2 37.2 13.3"
        fill="none"
        stroke="var(--tri-brand)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/*
       * The head, with a notch in its back.
       *
       * A flat-backed triangle was tried first. At this angle — the last leg climbs at about
       * sixty degrees — a straight back reads as a pennant on a pole rather than as an arrow,
       * and the eye takes a moment to work out which way it points. The notch is what makes it
       * unmistakable, and it is the one piece of detail here worth what it costs when small.
       */}
      <path d="M39.2 9.6 39.5 16 37.4 13 33.7 12.9Z" fill="var(--tri-brand)" />
    </svg>
  );
}
