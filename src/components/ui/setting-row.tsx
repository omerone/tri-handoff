import type { ReactNode } from 'react';

/**
 * One setting: what it is on one side, the control on the other, a hairline between rows.
 *
 * The settings screen was seven cards, one per choice, each with its own border, title and
 * padding. Every card was the same size whatever it held, so a segmented toggle with two
 * options and a paragraph of explanation took the same frame, and the page read as a scatter
 * of tiles rather than as a list of decisions. This is the shape settings pages actually
 * take — the label and its consequence on the reading side, the control on the far side,
 * separated rather than boxed — and it is denser without being tighter: what disappears is
 * border and title chrome, not explanation.
 *
 * The description is not optional decoration. Half of these choices cost money or change what
 * a number means, and a switch with no sentence under it is a switch someone leaves alone.
 */
export function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="border-line flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b py-3 last:border-b-0 last:pb-0 first:pt-0">
      <div className="min-w-0 flex-1">
        <div className="text-text text-[13px] font-semibold">{label}</div>
        {description ? (
          <div className="text-dim mt-0.5 text-[11px] leading-relaxed">{description}</div>
        ) : null}
      </div>
      {/* `shrink-0`: a segmented control has a natural width and squeezing it wraps the
          labels inside the buttons. On a narrow screen the row wraps instead, which puts the
          control on its own line under the text — the right answer at that width. */}
      <div className="shrink-0">{children}</div>
    </div>
  );
}
