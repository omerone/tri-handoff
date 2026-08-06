'use client';

import { useMemo } from 'react';
import { encode } from 'uqr';

/**
 * A QR code drawn as SVG rectangles, from the module matrix rather than from a rendered
 * string.
 *
 * `uqr` will hand back finished SVG markup, and using it would mean `dangerouslySetInnerHTML`
 * — a habit worth not forming for the sake of saving a loop, on a page whose whole subject is
 * account security. `encode` returns a boolean grid instead, and React draws it.
 *
 * The colours are fixed rather than themed, and that is not an oversight. A scanner expects
 * dark modules on a light field; inverting it for dark mode is a well-known way to produce a
 * code that half the phones in the world decline to read. The white square is drawn
 * explicitly for the same reason — a transparent background would show the app's dark
 * surface through the gaps.
 */

/** Modules of clear space around the code. Four is what the spec asks for; scanners rely on it. */
const QUIET_ZONE = 4;

export function QrCode({ text, label, size = 200 }: { text: string; label: string; size?: number }) {
  const matrix = useMemo(() => encode(text), [text]);
  const side = matrix.size + QUIET_ZONE * 2;

  return (
    <svg
      viewBox={`0 0 ${side} ${side}`}
      width={size}
      height={size}
      role="img"
      aria-label={label}
      className="rounded-[10px]"
    >
      <rect width={side} height={side} fill="#ffffff" />
      {matrix.data.flatMap((row, y) =>
        row.map((dark, x) =>
          dark ? (
            <rect
              key={`${x}-${y}`}
              x={x + QUIET_ZONE}
              y={y + QUIET_ZONE}
              width={1}
              height={1}
              fill="#000000"
            />
          ) : null,
        ),
      )}
    </svg>
  );
}
