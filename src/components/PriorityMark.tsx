import type { Priority } from "../lib/types";

export const PRIORITIES: [Priority, string][] = [["low", "Low"], ["medium", "Medium"], ["high", "High"]];
const LEVEL: Record<Priority, number> = { low: 1, medium: 2, high: 3 };

/**
 * Three bars that fill up with the priority, in its own colour, always with the word next to it,
 * so it never depends on colour alone.
 */
export function PriorityMark({ priority, label = true }: { priority: Priority | null; label?: boolean }) {
  if (!priority) return <span className="muted">—</span>;
  const level = LEVEL[priority];
  return (
    <span className={`prio prio-${priority}`}>
      <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <rect key={i} x={i * 5} y={8 - i * 4} width="3.5" height={4 + i * 4} rx="1" className={i < level ? "on" : "off"} />
        ))}
      </svg>
      {label ? <span>{PRIORITIES.find(([p]) => p === priority)![1]}</span> : <span className="sr-only">{priority} priority</span>}
    </span>
  );
}
