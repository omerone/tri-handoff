import type { ReactNode } from 'react';

/**
 * The surface every panel in the app sits on: 18px radius, thin hairline border, calm
 * padding — straight from the prototype's `Card`.
 *
 * The padding is a few pixels tighter than the prototype's. It is the same figure on every
 * card on every screen, so the analytics page — which stacks ten of them — was spending most
 * of a phone screen on the gaps between panels rather than on anything in them.
 */
export function Card({
  title,
  action,
  children,
  pad = true,
  fill = false,
  className = '',
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  pad?: boolean;
  /**
   * Take the full height of the grid row, and hand the extra to the body rather than leaving
   * it under the content.
   *
   * A grid row is as tall as its tallest card whatever this says. The question is what the
   * shorter ones do with the difference: stretch and leave it blank at the bottom, shrink and
   * leave the row ragged, or stretch and let whatever is inside grow into it. This is the
   * third, and it is the only one of the three that is both level across the row and not
   * mostly nothing — which is what the analytics page needed and neither of the others gave.
   */
  fill?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`border-line bg-surface rounded-[18px] border ${
        fill ? 'flex h-full flex-col' : ''
      } ${className}`}
    >
      {(title || action) && (
        <div className="flex items-center justify-between gap-2 px-4 pt-2.5 pb-1">
          <div className="text-dim text-xs font-semibold tracking-[0.3px]">{title}</div>
          {action}
        </div>
      )}
      <div
        className={`${pad ? 'px-4 pt-1 pb-3' : ''} ${fill ? 'flex min-h-0 flex-1 flex-col' : ''}`}
      >
        {children}
      </div>
    </div>
  );
}
