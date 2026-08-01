import type { ReactNode } from 'react';

/**
 * The surface every panel in the app sits on: 18px radius, thin hairline border, calm
 * padding — straight from the prototype's `Card`.
 */
export function Card({
  title,
  action,
  children,
  pad = true,
  className = '',
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  pad?: boolean;
  className?: string;
}) {
  return (
    <div className={`border-line bg-surface rounded-[18px] border ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-1">
          <div className="text-dim text-xs font-semibold tracking-[0.3px]">{title}</div>
          {action}
        </div>
      )}
      <div className={pad ? 'px-4 pt-1 pb-4' : ''}>{children}</div>
    </div>
  );
}
