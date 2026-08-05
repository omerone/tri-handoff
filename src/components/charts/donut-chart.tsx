'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

export type DonutSlice = {
  key: string;
  label: string;
  value: number;
  /** Preformatted on the server — "4.5h · 60%" — so this component never sees a locale. */
  caption: string;
  color: string;
};

/**
 * A share-of-total donut, for the questions that are about proportion rather than money.
 *
 * A donut rather than the bar chart the rest of the analytics page uses, because these
 * answer "how is this split" instead of "how much did this make". The P&L breakdowns are
 * signed and comparable across categories; these are parts of one whole, and a ring shows
 * that in a way parallel bars do not.
 *
 * Empty categories are kept rather than filtered. A month with no psychology study should
 * show psychology at zero — the gap is the finding, and a legend that quietly loses a row
 * reports a more balanced book than the data holds.
 */
export function DonutChart({
  data,
  total,
  centerLabel,
  emptyLabel,
}: {
  data: DonutSlice[];
  /** Rendered large in the middle, already formatted. */
  total: string;
  centerLabel: string;
  emptyLabel: string;
}) {
  const drawable = data.filter((slice) => slice.value > 0);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative shrink-0" style={{ width: 168, height: 168 }}>
        {drawable.length === 0 ? (
          /*
           * A dashed ring where the chart would be, and nothing written inside it. The
           * message belongs beside the ring rather than in it: the hole already holds the
           * total, and stacking a sentence on top of a number produced two lines of text
           * overlapping each other.
           */
          <div className="border-line absolute inset-2 rounded-full border border-dashed" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={drawable}
                dataKey="value"
                nameKey="label"
                innerRadius={52}
                outerRadius={80}
                paddingAngle={drawable.length > 1 ? 2 : 0}
                strokeWidth={0}
                // A ring that spins on every re-render is noise, and this page re-renders
                // whenever the shared range changes.
                isAnimationActive={false}
              >
                {drawable.map((slice) => (
                  <Cell key={slice.key} fill={slice.color} />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const slice = payload[0]?.payload as DonutSlice | undefined;
                  if (!slice) return null;
                  return (
                    <div className="border-line bg-raised rounded-[10px] border px-2.5 py-1.5 text-xs">
                      <div className="text-dim">{slice.label}</div>
                      <div className="tri-num text-text">{slice.caption}</div>
                    </div>
                  );
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        )}

        {/* The total belongs in the hole rather than above the chart: it is what every slice
            is a share of, and putting it anywhere else makes the reader hunt for the base. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="tri-num text-text text-lg font-extrabold">{total}</span>
          <span className="text-dim text-[10px]">{centerLabel}</span>
        </div>
      </div>

      {/*
        The legend doubles as the empty state. A zeroed legend is honest but says nothing
        about *why* it is zero, and the sentence that explains it has nowhere else to go once
        the ring's centre is spoken for.
      */}
      {drawable.length === 0 ? (
        <p className="text-dim min-w-0 flex-1 text-xs leading-relaxed">{emptyLabel}</p>
      ) : (
      <ul className="flex min-w-0 flex-1 flex-col gap-1.5">
        {data.map((slice) => (
          <li key={slice.key} className="flex items-baseline gap-2 text-xs">
            <span
              aria-hidden
              className="mt-0.5 size-2.5 shrink-0 rounded-[3px]"
              style={{ background: slice.color }}
            />
            <span className="text-text min-w-0 flex-1 truncate">{slice.label}</span>
            <span className="tri-num text-dim shrink-0">{slice.caption}</span>
          </li>
        ))}
      </ul>
      )}
    </div>
  );
}
