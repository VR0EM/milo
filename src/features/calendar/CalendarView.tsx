import { useEffect, useMemo } from "react";
import { pickDefaultSpace } from "../../lib/spaces";
import { useActivities, useArchiveWithUndo, useCreateEvent, useEvents, useSpaces, useTaskTypes, useTasks } from "../../lib/queries";
import { useUi, type CalMode } from "../../lib/store";
import { addDays, atMinutes, fmtLongDay, fmtMonth, isoWeek, minutesIntoDay, startOfDay } from "../../lib/time";
import { Icon } from "../../components/Icon";
import { ignoreForShortcut } from "../shortcuts/keys";
import { TaskPanel } from "../tasks/TaskPanel";
import { EventPanel } from "./EventPanel";
import { WeekGrid } from "./WeekGrid";
import { MonthGrid, monthWeeks } from "./MonthGrid";
import { TaskDragGhost } from "./TaskTray";

const MODES: [CalMode, string, string][] = [["day", "Day", "D"], ["week", "Week", "W"], ["month", "Month", "M"]];
import { BUFFER, firstShown, shiftShown } from "./days";

export function CalendarView() {
  const viewStart = useUi((s) => s.viewStart);
  const selectedId = useUi((s) => s.selectedEventId);
  const hidden = useUi((s) => s.hiddenSpaceIds);
  const lastSpaceId = useUi((s) => s.lastSpaceId);
  const archive = useArchiveWithUndo();
  const createEvent = useCreateEvent();

  const mode = useUi((s) => s.calMode);
  const showWeekends = useUi((s) => s.prefs.showWeekends);
  const eventMinutes = useUi((s) => s.prefs.eventMinutes);
  // The day view always steps through every day; the week and month follow the weekend setting.
  const gridWeekends = mode === "day" || showWeekends;
  const visibleCount = mode === "day" ? 1 : showWeekends ? 7 : 5;
  const start = firstShown(viewStart, gridWeekends);
  // Visible days plus a buffer on both sides, so scrolling sideways never shows an empty column.
  const days = useMemo(
    () => Array.from({ length: visibleCount + 2 * BUFFER }, (_, i) => shiftShown(start, i - BUFFER, gridWeekends)),
    [start.getTime(), gridWeekends, visibleCount], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const weeks = useMemo(() => monthWeeks(viewStart), [viewStart.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps
  const from = mode === "month" ? weeks[0] : days[0];
  const to = useMemo(
    () => (mode === "month" ? addDays(weeks[weeks.length - 1], 7) : addDays(days[days.length - 1], 1)),
    [mode, weeks, days],
  );

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
  const defaultSpaceId = pickDefaultSpace(active, lastSpaceId)?.id ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ignoreForShortcut(e)) return;
      const ui = useUi.getState();
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        archive("event", selected.id, selected.title || "Event");
        ui.select(null);
      } else if (e.key === "Escape") ui.select(null); // also clears a selected task
      else if (e.key === "t") ui.showDate(new Date());
      else if (e.key === "d" || e.key === "w" || e.key === "m") ui.setCalMode(e.key === "d" ? "day" : e.key === "w" ? "week" : "month");
      else if (e.key === "n" && defaultSpaceId) {
        const now = new Date();
        const start = atMinutes(startOfDay(now), Math.ceil(minutesIntoDay(now) / 30) * 30);
        ui.showDate(start);
        createEvent.mutate(
          {
            spaceId: defaultSpaceId, activityId: null, title: "", allDay: false, notes: "", status: "planned",
            startAt: start.toISOString(), endAt: new Date(start.getTime() + eventMinutes * 60_000).toISOString(),
          },
          { onSuccess: (created) => useUi.getState().select(created.id, true) },
        );
      }
      else if (e.key === "ArrowLeft") ui.stepCalendar(-1);
      else if (e.key === "ArrowRight") ui.stepCalendar(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, archive, defaultSpaceId, createEvent, eventMinutes]);

  return (
    <>
      <main className="calendar">
        <header className="toolbar">
          <h1>
            {mode === "day" ? fmtLongDay(viewStart) : fmtMonth(mode === "week" ? addDays(viewStart, 3) : viewStart)}
            {mode !== "month" && <span className="h1-note">Week {isoWeek(mode === "week" ? addDays(viewStart, 3) : viewStart)}</span>}
          </h1>
          <div className="toolbar-actions">
            <div className="segmented" role="radiogroup" aria-label="Calendar view">
              {MODES.map(([m, label, key]) => (
                <button key={m} role="radio" aria-checked={mode === m} className={mode === m ? "on" : ""} title={`${label} (${key})`} onClick={() => useUi.getState().setCalMode(m)}>
                  {label}
                </button>
              ))}
            </div>
            <button className="btn" onClick={() => useUi.getState().showDate(new Date())}>Today</button>
            <div className="btn-pair">
              <button className="btn icon-only" aria-label={`Previous ${mode}`} title={`Previous ${mode} (←)`} onClick={() => useUi.getState().stepCalendar(-1)}>
                <Icon name="left" />
              </button>
              <button className="btn icon-only" aria-label={`Next ${mode}`} title={`Next ${mode} (→)`} onClick={() => useUi.getState().stepCalendar(1)}>
                <Icon name="right" />
              </button>
            </div>
          </div>
        </header>
        <TaskDragGhost />
        {mode === "month" ? (
          <MonthGrid month={viewStart} weekends={showWeekends} events={visible} tasks={tasks} spaces={spaces} defaultSpaceId={defaultSpaceId} />
        ) : (
          <WeekGrid key={mode} days={days} visibleCount={visibleCount} buffer={BUFFER} weekends={gridWeekends} events={visible} tasks={tasks} spaces={spaces} defaultSpaceId={defaultSpaceId} />
        )}
      </main>
      {selectedTask ? (
        <TaskPanel task={selectedTask} spaces={spaces} types={taskTypes} />
      ) : (
        <EventPanel event={selected} spaces={spaces} activities={activities} />
      )}
    </>
  );
}
