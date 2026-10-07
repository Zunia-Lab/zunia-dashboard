"use client";

export interface ChartTableColumn {
  key: string;
  label: string;
  align?: "left" | "right";
}

export interface ChartTableProps {
  /** Says what the table is; read by screen readers, not shown. */
  caption: string;
  columns: readonly ChartTableColumn[];
  /** Pre-formatted cells, keyed by column. */
  rows: ReadonlyArray<{ key: string | number; cells: Readonly<Record<string, string>> }>;
  /** The chart's own height, so flipping between views never moves the page. */
  height?: number;
  className?: string;
}

/**
 * The table twin of a chart: the same numbers as plain rows. It is what makes
 * a tooltip an enhancement instead of a gate (every value is reachable without
 * hovering) and the accessible equivalent of the drawing. It takes the
 * chart's footprint, so a long series scrolls inside it rather than growing
 * the card.
 */
export function ChartTable({ caption, columns, rows, height, className }: ChartTableProps) {
  return (
    <div
      className={className ? `viz-table-wrap ${className}` : "viz-table-wrap"}
      style={height ? { height } : undefined}
      tabIndex={0}
      role="region"
      aria-label={caption}
    >
      <table className="viz-table">
        <caption className="viz-sr">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" data-align={c.align}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              {columns.map((c) => (
                <td key={c.key} data-align={c.align}>
                  {row.cells[c.key] ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
