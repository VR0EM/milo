import { useState } from "react";

export interface Series {
  name: string;
  color: string; // a CSS colour, e.g. var(--series-class)
}
export interface Column {
  key: string;
  label: string; // under the axis; may be empty to thin out labels
  title: string; // tooltip heading
  values: number[]; // minutes, one per series
}

const hours = (min: number) => min / 60;

/** Round tick step so the axis has at most four lines. */
function ticks(maxMinutes: number): number[] {
  const max = Math.max(hours(maxMinutes), 1);
  const step = [0.5, 1, 2, 3, 4, 5, 10, 20, 50].find((s) => max / s <= 4) ?? 100;
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
}

export function fmtMinutes(min: number) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

/**
 * Stacked columns, one axis in hours. Hover or focus a column for its numbers.
 * The first series sits at the bottom.
 */
export function ColumnChart({ columns, series, label }: { columns: Column[]; series: Series[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const axis = ticks(Math.max(0, ...columns.map((c) => c.values.reduce((a, b) => a + b, 0))));
  const top = axis[axis.length - 1] * 60;
  const hovered = hover === null ? null : columns[hover];

  return (
    <div>
      <div className="chart" role="img" aria-label={label}>
        <div className="chart-axis">
          {axis.map((t) => (
            <span key={t} style={{ bottom: `${(t * 60 / top) * 100}%` }}>{t} h</span>
          ))}
        </div>
        <div className="chart-plot" onMouseLeave={() => setHover(null)}>
          {axis.slice(1).map((t) => (
            <div key={t} className="chart-grid" style={{ bottom: `${(t * 60 / top) * 100}%` }} />
          ))}
          {columns.map((c, i) => (
            <div
              key={c.key}
              className="chart-col"
              tabIndex={0}
              aria-label={`${c.title}: ${series.map((s, j) => `${s.name} ${fmtMinutes(c.values[j])}`).join(", ")}`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            >
              <div className="chart-stack">
                {c.values.map((v, j) =>
                  v > 0 ? (
                    <div key={j} className="chart-seg" style={{ height: `${(v / top) * 180}px`, ["--s" as string]: series[j].color }} />
                  ) : null,
                )}
              </div>
            </div>
          ))}
          {hovered && hover !== null && (
            // Beside the column, inside the plot: never over the hovered bar or the block's heading.
            <div
              className="tooltip"
              style={
                hover < columns.length / 2
                  ? { left: `calc(${((hover + 1) / columns.length) * 100}% + 6px)`, top: 0 }
                  : { right: `calc(${((columns.length - hover) / columns.length) * 100}% + 6px)`, top: 0 }
              }
            >
              <div className="t-title">{hovered.title}</div>
              {series.map((s, j) => (
                <div key={s.name} className="t-row">
                  <i style={{ ["--s" as string]: s.color }} />
                  <span>{s.name}</span>
                  <span className="t-val">{fmtMinutes(hovered.values[j])}</span>
                </div>
              ))}
              {series.length > 1 && (
                <div className="t-row">
                  <span>Total</span>
                  <span className="t-val">{fmtMinutes(hovered.values.reduce((a, b) => a + b, 0))}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="chart-x" aria-hidden="true">
        {columns.map((c) => <span key={c.key}>{c.label}</span>)}
      </div>
    </div>
  );
}

export function Legend({ series }: { series: Series[] }) {
  return (
    <div className="legend">
      {series.map((s) => (
        <span key={s.name}>
          <i style={{ ["--s" as string]: s.color }} />
          {s.name}
        </span>
      ))}
    </div>
  );
}

/** The same numbers as a table, for reading exact values. */
export function DataTable({ columns, series }: { columns: Column[]; series: Series[] }) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Period</th>
          {series.map((s) => <th key={s.name}>{s.name}</th>)}
          {series.length > 1 && <th>Total</th>}
        </tr>
      </thead>
      <tbody>
        {columns.map((c) => (
          <tr key={c.key}>
            <td>{c.title}</td>
            {c.values.map((v, j) => <td key={j}>{fmtMinutes(v)}</td>)}
            {series.length > 1 && <td>{fmtMinutes(c.values.reduce((a, b) => a + b, 0))}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
