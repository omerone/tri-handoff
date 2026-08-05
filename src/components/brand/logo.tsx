/**
 * The TRi mark: the R-strip.
 *
 * The strip is the product's signature element — one column per trading day, winners growing
 * up from a centre line and losers down — and it is the one picture no other trading app
 * shows. So the mark is not a picture *of* the product, it is a small piece of it: four days,
 * three green and one red, around the zero line.
 *
 * Two earlier marks were rejected on the way here, both for the same reason. Three letters in
 * a gradient square is a placeholder: at 36px the middle letter is four pixels wide and the
 * mark only repeats the wordmark beside it. Three ascending bars is better drawn, but it is
 * the most common image in finance and says nothing this product does that others do not.
 *
 * No tile. A rounded square behind the bars puts an indigo ground under green and red, which
 * muddies both, and the tile was only ever there to give the letters something to sit on.
 * Without it the mark is the data, and it takes the page's own background.
 *
 * Colour comes from the theme's own tokens — the same green and red every profit and loss in
 * the product is drawn in — so the mark follows light and dark rather than carrying frozen
 * hex. `src/app/icon.svg` is the same drawing with the dark values baked in, because a file
 * served as a favicon has no page to read a variable from; the two are kept in step by hand.
 *
 * At 16px it is four marks around a rule. That is the trade this direction makes: less legible
 * in a browser tab than a solid tile, and unmistakable everywhere else.
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
      {/* The zero line, in the interface's own text colour at a low opacity — the same way the
          strip draws it on the dashboard, where it separates a green day from a red one. */}
      <rect x="2" y="22.75" width="44" height="2" rx="1" fill="currentColor" fillOpacity="0.3" />

      {/*
       * Four days, sitting on the line rather than crossing it: a winner's base is the line's
       * top edge, a loser's is its bottom.
       *
       * `rx` is 2 on a 9-wide bar — the same soft corner the strip itself uses on the
       * dashboard. Rounding to half the width was tried first and turned the mark into four
       * lozenges: the short bars became dots, the red one a pill, and the row of columns read
       * as scattered confetti rather than as days on an axis.
       *
       * They fill the box, too. The first cut used two thirds of the width and height, which
       * left half the square empty and made the mark a smudge beside a bold wordmark.
       *
       * The shape is a month worth having — two good days, one small, one bad — because a mark
       * showing four winners would be the one thing a trading journal must never claim.
       */}
      <rect x="2.25" y="13" width="9" height="9.75" rx="2" fill="var(--tri-pos)" />
      <rect x="13.75" y="24.75" width="9" height="8" rx="2" fill="var(--tri-neg)" />
      <rect x="25.25" y="6" width="9" height="16.75" rx="2" fill="var(--tri-pos)" />
      <rect x="36.75" y="16.75" width="9" height="6" rx="2" fill="var(--tri-pos)" />
    </svg>
  );
}
