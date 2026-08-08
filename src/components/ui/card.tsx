import type { ReactNode } from 'react';
import { Info } from 'lucide-react';

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
  info,
  infoLabel,
  className = '',
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  pad?: boolean;
  /**
   * What this panel is answering, in full sentences — see `info-layer.tsx`.
   *
   * The same mark the KPI tiles carry, in the same place relative to what it explains. A
   * chart title has room for four words and most of these panels answer a question that takes
   * a paragraph: "by hour opened" does not say that it is the finest cut on the page and has
   * to be read against the trade counts, and a reader who does not know that reads two trades
   * in an hour as a pattern.
   */
  info?: string;
  /** Usually the title; separate because a title can be a node rather than a string. */
  infoLabel?: string;
  className?: string;
}) {
  return (
    <div className={`border-line tri-pane rounded-[18px] border ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-2 px-4 pt-2.5 pb-1">
          <div className="text-dim flex min-w-0 items-center gap-1 text-xs font-semibold tracking-[0.3px]">
            <span className="min-w-0">{title}</span>
            {info ? (
              <button
                type="button"
                data-info={info}
                aria-label={infoLabel ?? (typeof title === 'string' ? title : '')}
                className="text-dim/50 hover:text-text focus-visible:text-text -m-1 shrink-0 p-1 leading-none"
              >
                <Info size={12} aria-hidden />
              </button>
            ) : null}
          </div>
          {action}
        </div>
      )}
      <div className={pad ? 'px-4 pt-1 pb-3' : ''}>{children}</div>
    </div>
  );
}
