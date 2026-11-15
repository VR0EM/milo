import { HelpTip } from "../../components/HelpTip";
import { useEffect, useMemo, useRef } from "react";
import { colorVar } from "../../lib/colors";
import { useSpaces, useTasks } from "../../lib/queries";
import { useUi } from "../../lib/store";
import { daysFromToday, fmtRelativeDays } from "../../lib/time";
import type { Task } from "../../lib/types";
import { pressTask, useTaskDrag } from "./taskDrag";
import { SpaceMark } from "../../components/Icon";

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;

/** Open tasks in the order they need time: overdue and soonest deadline first, then priority. */
export function byUrgency(a: Task, b: Task) {
  const da = a.deadlineAt ?? "9999";
  const db = b.deadlineAt ?? "9999";
  const pa = a.priority ? PRIORITY_RANK[a.priority] : 3;
  const pb = b.priority ? PRIORITY_RANK[b.priority] : 3;
  return da.localeCompare(db) || pa - pb || a.title.localeCompare(b.title);
}

/** Beside the calendar: open tasks to drag onto the hours, which plans time for them. */
export function TaskTray() {
  const tasks = useTasks().data ?? [];
  const spaces = useSpaces().data ?? [];
  const hidden = useUi((s) => s.hiddenSpaceIds);
  const mode = useUi((s) => s.calMode);
  const highlight = useUi((s) => s.planTaskId);
  const dragging = useTaskDrag((s) => s.task?.id ?? null);
  const spaceById = useMemo(() => new Map(spaces.map((s) => [s.id, s])), [spaces]);
  const open = tasks.filter((t) => !t.completedAt && !hidden.includes(t.spaceId)).sort(byUrgency);
  const listRef = useRef<HTMLUListElement>(null);

  // "Plan time" on a task brings it into view here.
  useEffect(() => {
    if (!highlight) return;
    listRef.current?.querySelector(`[data-task="${highlight}"]`)?.scrollIntoView({ block: "nearest" });
    const t = setTimeout(() => useUi.setState({ planTaskId: null }), 2500);
    return () => clearTimeout(t);
  }, [highlight]);

  if (open.length === 0) return null;
  return (
    <section className="task-tray" aria-label="Plan time for a task">
      <h3>
        Plan a task
        <HelpTip label="About planning a task">
          {mode === "month"
            ? "Switch to the day or week view, then drag a task onto the hours to set time aside for it."
            : "Drag a task onto the hours to set time aside for it. Starting focus from that block fills it in."}
        </HelpTip>
      </h3>
      <ul ref={listRef}>
        {open.map((t) => {
          const days = t.deadlineAt ? daysFromToday(new Date(t.deadlineAt)) : null;
          return (
            <li key={t.id}>
              <div
                data-task={t.id}
                className={`tray-task${t.id === highlight ? " highlight" : ""}${t.id === dragging ? " drag-source" : ""}`}
                style={{ ["--c" as string]: colorVar(spaceById.get(t.spaceId)?.color ?? "gray") }}
                onPointerDown={(e) => mode !== "month" && pressTask(e, t)}
                title={mode === "month" ? undefined : "Drag onto the calendar"}
              >
                <SpaceMark icon={spaceById.get(t.spaceId)?.icon} />
                <span className="tray-title">{t.title || "Untitled"}</span>
                {days !== null && <span className={`tray-due small${days < 0 ? " late" : ""}`}>{fmtRelativeDays(days)}</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The task's name follows the pointer while it is dragged. */
export function TaskDragGhost() {
  const task = useTaskDrag((s) => s.task);
  const x = useTaskDrag((s) => s.x);
  const y = useTaskDrag((s) => s.y);
  if (!task) return null;
  return (
    <div className="task-ghost" style={{ left: x + 12, top: y + 10 }} aria-hidden>
      {task.title || "Untitled task"}
    </div>
  );
}
