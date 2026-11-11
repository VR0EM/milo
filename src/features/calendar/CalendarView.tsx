import { useEffect, useMemo } from "react";
import { useActivities, useArchiveWithUndo, useEvents, useSpaces, useTaskTypes, useTasks } from "../../lib/queries";
import { useUi } from "../../lib/store";
import { addDays, fmtMonth, startOfWeek } from "../../lib/time";
import { TaskPanel } from "../tasks/TaskPanel";
import { EventPanel } from "./EventPanel";
import { WeekGrid } from "./WeekGrid";

const VISIBLE_DAYS = 7;

export function CalendarView() {
  const viewStart = useUi((s) => s.viewStart);
  const setViewStart = useUi((s) => s.setViewStart);
  const selectedId = useUi((s) => s.selectedEventId);
  const hidden = useUi((s) => s.hiddenSpaceIds);
  const lastSpaceId = useUi((s) => s.lastSpaceId);
  const archive = useArchiveWithUndo();

  const days = useMemo(() => Array.from({ length: VISIBLE_DAYS }, (_, i) => addDays(viewStart, i)), [viewStart]);
  const to = useMemo(() => addDays(viewStart, VISIBLE_DAYS), [viewStart]);

  const spaces = useSpaces().data ?? [];
  const activities = useActivities().data ?? [];
  const events = useEvents(viewStart, to).data ?? [];
  const allTasks = useTasks().data ?? [];
  const taskTypes = useTaskTypes().data ?? [];
  const selectedTaskId = useUi((s) => s.selectedTaskId);
  const tasks = useMemo(() => allTasks.filter((t) => !hidden.includes(t.spaceId)), [allTasks, hidden]);
  const selectedTask = allTasks.find((t) => t.id === selectedTaskId) ?? null;

  const visible = useMemo(() => events.filter((e) => !hidden.includes(e.spaceId)), [events, hidden]);
  const selected = events.find((e) => e.id === selectedId) ?? null;
  const active = spaces.filter((s) => !s.deletedAt);
  const defaultSpaceId = (active.find((s) => s.id === lastSpaceId) ?? active[0])?.id ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof Element && e.target.closest("input, textarea, select, dialog");
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const ui = useUi.getState();
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        archive("event", selected.id, selected.title || "Event");
        ui.select(null);
      } else if (e.key === "Escape") ui.select(null); // also clears a selected task
      else if (e.key === "t") ui.setViewStart(startOfWeek(new Date()));
      else if (e.key === "ArrowLeft") ui.setViewStart(addDays(ui.viewStart, -7));
      else if (e.key === "ArrowRight") ui.setViewStart(addDays(ui.viewStart, 7));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, archive]);

  return (
    <>
      <main className="calendar">
        <header className="toolbar">
          <h1>{fmtMonth(addDays(viewStart, 3))}</h1>
          <div className="toolbar-actions">
            <button className="btn" onClick={() => setViewStart(startOfWeek(new Date()))}>Today</button>
            <button className="btn" aria-label="Previous week" onClick={() => setViewStart(addDays(viewStart, -7))}>‹</button>
            <button className="btn" aria-label="Next week" onClick={() => setViewStart(addDays(viewStart, 7))}>›</button>
          </div>
        </header>
        <WeekGrid days={days} events={visible} tasks={tasks} spaces={spaces} defaultSpaceId={defaultSpaceId} />
      </main>
      {selectedTask ? (
        <TaskPanel task={selectedTask} spaces={spaces} types={taskTypes} />
      ) : (
        <EventPanel event={selected} spaces={spaces} activities={activities} />
      )}
    </>
  );
}
