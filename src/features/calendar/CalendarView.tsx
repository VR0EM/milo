import { useEffect, useMemo } from "react";
import { useActivities, useArchiveWithUndo, useCreateEvent, useEvents, useSpaces, useTaskTypes, useTasks } from "../../lib/queries";
import { useUi } from "../../lib/store";
import { addDays, atMinutes, fmtMonth, isoWeek, minutesIntoDay, startOfDay, startOfWeek } from "../../lib/time";
import { Icon } from "../../components/Icon";
import { ignoreForShortcut } from "../shortcuts/keys";
import { TaskPanel } from "../tasks/TaskPanel";
import { EventPanel } from "./EventPanel";
import { WeekGrid } from "./WeekGrid";
import { BUFFER, firstShown, shiftShown } from "./days";

export function CalendarView() {
  const viewStart = useUi((s) => s.viewStart);
  const setViewStart = useUi((s) => s.setViewStart);
  const selectedId = useUi((s) => s.selectedEventId);
  const hidden = useUi((s) => s.hiddenSpaceIds);
  const lastSpaceId = useUi((s) => s.lastSpaceId);
  const archive = useArchiveWithUndo();
  const createEvent = useCreateEvent();

  const showWeekends = useUi((s) => s.prefs.showWeekends);
  const eventMinutes = useUi((s) => s.prefs.eventMinutes);
  const visibleCount = showWeekends ? 7 : 5;
  const start = firstShown(viewStart, showWeekends);
  // Visible days plus a buffer on both sides, so scrolling sideways never shows an empty column.
  const days = useMemo(
    () => Array.from({ length: visibleCount + 2 * BUFFER }, (_, i) => shiftShown(start, i - BUFFER, showWeekends)),
    [start.getTime(), showWeekends, visibleCount], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const from = days[0];
  const to = useMemo(() => addDays(days[days.length - 1], 1), [days]);

  const spaces = useSpaces().data ?? [];
  const activities = useActivities().data ?? [];
  const events = useEvents(from, to).data ?? [];
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
      if (ignoreForShortcut(e)) return;
      const ui = useUi.getState();
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        archive("event", selected.id, selected.title || "Event");
        ui.select(null);
      } else if (e.key === "Escape") ui.select(null); // also clears a selected task
      else if (e.key === "t") ui.setViewStart(startOfWeek(new Date()));
      else if (e.key === "n" && defaultSpaceId) {
        const now = new Date();
        const start = atMinutes(startOfDay(now), Math.ceil(minutesIntoDay(now) / 30) * 30);
        ui.setViewStart(startOfWeek(start));
        createEvent.mutate(
          {
            spaceId: defaultSpaceId, activityId: null, title: "", allDay: false, notes: "", status: "planned",
            startAt: start.toISOString(), endAt: new Date(start.getTime() + eventMinutes * 60_000).toISOString(),
          },
          { onSuccess: (created) => useUi.getState().select(created.id, true) },
        );
      }
      else if (e.key === "ArrowLeft") ui.setViewStart(addDays(ui.viewStart, -7));
      else if (e.key === "ArrowRight") ui.setViewStart(addDays(ui.viewStart, 7));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, archive, defaultSpaceId, createEvent, eventMinutes]);

  return (
    <>
      <main className="calendar">
        <header className="toolbar">
          <h1>
            {fmtMonth(addDays(viewStart, 3))}
            <span className="h1-note">Week {isoWeek(addDays(viewStart, 3))}</span>
          </h1>
          <div className="toolbar-actions">
            <button className="btn" onClick={() => setViewStart(startOfWeek(new Date()))}>Today</button>
            <div className="btn-pair">
              <button className="btn icon-only" aria-label="Previous week" title="Previous week (←)" onClick={() => setViewStart(addDays(viewStart, -7))}>
                <Icon name="left" />
              </button>
              <button className="btn icon-only" aria-label="Next week" title="Next week (→)" onClick={() => setViewStart(addDays(viewStart, 7))}>
                <Icon name="right" />
              </button>
            </div>
          </div>
        </header>
        <WeekGrid days={days} visibleCount={visibleCount} buffer={BUFFER} weekends={showWeekends} events={visible} tasks={tasks} spaces={spaces} defaultSpaceId={defaultSpaceId} />
      </main>
      {selectedTask ? (
        <TaskPanel task={selectedTask} spaces={spaces} types={taskTypes} />
      ) : (
        <EventPanel event={selected} spaces={spaces} activities={activities} />
      )}
    </>
  );
}
