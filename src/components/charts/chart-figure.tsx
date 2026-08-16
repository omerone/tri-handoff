import type { ReactNode } from 'react';

export type ChartTable = {
  /** What the table is of, for a reader who arrives at it out of context. */
  caption: string;
  columns: string[];
  /** Preformatted: the same strings the chart's own axes and tooltips print. */
  rows: string[][];
};

/**
 * A chart, and the same chart as something you can read.
 *
 * Every drawing in this directory was a `<div>` full of SVG and nothing else: no name, no
 * description, and no way to reach the numbers except by pointing at them. To anything that
 * is not a pair of eyes — a screen reader, a page read aloud in a car, a text-only export —
 * the whole dashboard was blank in exactly the places it says the most.
 *
 * So each one gets three things, and none of them change a pixel:
 *
 * `role="img"` with a name, which is what a chart *is*: one graphic, not a tree of forty
 * `<path>` elements. Without the role, assistive technology walks into the SVG and reads out
 * coordinates; with it, the drawing is announced once, by name, and skipped.
 *
 * A one-line summary — the trend, the total, the extremes — because that is what a sighted
 * reader takes from a glance, and it is the thing a table of forty rows does not give back.
 *
 * The numbers themselves, as a real table, hidden visually and present in full. Not a
 * paraphrase of the chart: the same values, formatted by the same functions the axes use, so
 * the two cannot drift apart. `sr-only` rather than a toggle, because a control that reveals
 * a table is a control nobody finds, and the table is worth nothing to the people who can see
 * the picture.
 *
 * The chart keeps its own markup exactly as it was — this wraps, it does not restructure.
 */
export function ChartFigure({
  label,
  summary,
  table,
  children,
  className = '',
}: {
  /** Names the graphic: "Equity curve", not "chart". */
  label: string;
  /** One sentence a person could act on without seeing it. */
  summary: string;
  /** The data behind it. Omitted only when the chart has none to give. */
  table?: ChartTable;
  children: ReactNode;
  className?: string;
}) {
  return (
    <figure className={`m-0 ${className}`}>
      {/*
        The drawing, named and treated as one graphic. Nothing inside it is focusable — the
        tooltips are pointer-driven and the axes are text nodes — so closing the subtree off
        traps no keyboard user in it.
      */}
      <div role="img" aria-label={`${label}. ${summary}`}>
        {children}
      </div>

      <figcaption className="sr-only">
        {table ? (
          /*
           * Named by an attribute rather than a `<caption>`.
           *
           * A caption is text in the document, and the natural caption for this table is the
           * title of the card it sits in — so the page ended up with the same words twice,
           * and three existing tests looking for that title started finding two of it. A
           * name is what a screen reader needs here; a second copy of the words is not.
           */
          <table aria-label={table.caption}>
            <thead>
              <tr>
                {table.columns.map((column) => (
                  <th key={column} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, column) => (
                    /* The first cell names the row — a date, a category — so a screen reader
                       announces "12/08, ₪1,240" rather than two numbers in a row. */
                    <td key={column}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </figcaption>
    </figure>
  );
}
