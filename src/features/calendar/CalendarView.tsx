import { useEffect, useMemo, useRef, useState } from "react";
import { pickDefaultSpace } from "../../lib/spaces";
import { useActivities, useArchiveWithUndo, useCreateEvent, useEventById, useEvents, useSpaces, useTaskTypes, useTasks } from "../../lib/queries";
import { MAX_DAYS, preferredSpace, useUi, type CalMode } from "../../lib/store";
import { addDays, atMinutes, fmtLongDay, fmtMonth, isoWeek, minutesIntoDay, startOfDay } from "../../lib/time";
import { Icon } from "../../components/Icon";
import { MonthPicker } from "../../components/MonthPicker";
import { IS_MAC, ignoreForShortcut, isTyping } from "../shortcuts/keys";
import { TaskPanel } from "../tasks/TaskPanel";
import { EventPanel } from "./EventPanel";
import { WeekGrid } from "./WeekGrid";
import { MonthGrid, monthWeeks } from "./MonthGrid";
import { TaskDragGhost } from "./TaskTray";

const MODES: [CalMode, string, string][] = [["day", "Day", "D"], ["week", "Week", "W"], ["month", "Month", "M"]];
import { BUFFER, firstShown, shiftShown } from "./days";

/** What the arrows move by, in words. */
const STEP: Record<CalMode, string> = { day: "day", week: "week", month: "month" };

export function CalendarView() {
  const viewStart = useUi((s) => s.viewStart);
  const selectedId = useUi((s) => s.selectedEventId);
  const hidden = useUi((s) => s.hiddenSpaceIds);
  const lastSpaceId = useUi(preferredSpace);
  const archive = useArchiveWithUndo();
  const createEvent = useCreateEvent();

  const mode = useUi((s) => s.calMode);
  const showWeekends = useUi((s) => s.prefs.showWeekends);
  const eventMinutes = useUi((s) => s.prefs.eventMinutes);
  // The day and 3-day views always show consecutive days; the week and month follow the
  // weekend setting.
  const dayCount = useUi((s) => s.dayCount);
  const [picking, setPicking] = useState(false);
  const gridWeekends = mode === "day" || showWeekends;
  const visibleCount = mode === "day" ? dayCount : showWeekends ? 7 : 5;
  const stepWord = mode === "day" && dayCount > 1 ? `${dayCount} days` : STEP[mode];
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
  // The selected event stays open while the calendar moves to days without it.
  const selectedById = useEventById(selectedId).data?.find((e) => e.id === selectedId) ?? null;
  const selected = events.find((e) => e.id === selectedId) ?? selectedById;
  const active = spaces.filter((s) => !s.deletedAt);
  const defaultSpaceId = pickDefaultSpace(active, lastSpaceId)?.id ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Copy, cut and paste events: Ctrl on Windows, Cmd on a Mac.
      if ((IS_MAC ? e.metaKey : e.ctrlKey) && !e.shiftKey && !e.altKey && !isTyping(e) && !e.repeat) {
        const key = e.key.toLowerCase();
        const ui = useUi.getState();
        if ((key === "c" || key === "x") && selected) {
          e.preventDefault();
          useUi.setState({ clipboard: selected, pasteAt: null });
          if (key === "x") {
            archive("event", selected.id, selected.title || "Event");
            ui.select(null);
          } else ui.notify({ text: `Copied "${selected.title || "Untitled"}"` });
          return;
        }
        if (key === "v" && ui.clipboard) {
          e.preventDefault();
          const c = ui.clipboard;
          const s0 = new Date(c.startAt);
          const length = new Date(c.endAt).getTime() - s0.getTime();
          let start = s0;
          if (ui.pasteAt) {
            start = new Date(ui.pasteAt);
            // A day in the month view: the copy keeps its own time of day.
            if (ui.pasteDayOnly || c.allDay) start.setHours(c.allDay ? 0 : s0.getHours(), c.allDay ? 0 : s0.getMinutes(), 0, 0);
          }
          createEvent.mutate(
            {
              spaceId: c.spaceId, activityId: c.activityId, title: c.title, notes: c.notes, allDay: c.allDay, status: "planned",
              startAt: start.toISOString(), endAt: new Date(start.getTime() + length).toISOString(),
            },
            { onSuccess: (created) => useUi.getState().select(created.id) },
          );
          return;
        }
      }
      if (ignoreForShortcut(e)) return;
      const ui = useUi.getState();
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        archive("event", selected.id, selected.title || "Event");
        ui.select(null);
      } else if (e.key === "Escape") ui.select(null); // also clears a selected task
      else if (e.key === "t") ui.showDate(new Date());
      else if (e.key === "g") {
        // Go to a date: the command menu reads typed dates.
        e.preventDefault();
        useUi.setState({ commandOpen: true });
      }
      else if (e.key === "d") ui.setDayCount(1);
      else if (e.key === "w" || e.key === "m") ui.setCalMode(e.key === "w" ? "week" : "month");
      // 2 to 9: the day view with that many days.
      else if (/^[2-9]$/.test(e.key)) ui.setDayCount(Number(e.key));
      else if (e.key === "n" && defaultSpaceId) {
        // Keep the "n" itself out of the new event's title field, which takes the focus.
        e.preventDefault();
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
          <h1 className="cal-title">
            {/* The name opens a month and year list to jump far at once. */}
            <button className="month-title" aria-haspopup="dialog" aria-expanded={picking} title="Go to another month" onClick={() => setPicking(!picking)}>
              {mode === "day" && dayCount === 1 ? fmtLongDay(viewStart) : fmtMonth(mode === "week" ? addDays(viewStart, 3) : viewStart)}
            </button>
            {picking && (
              <MonthPicker
                value={mode === "week" ? addDays(viewStart, 3) : viewStart}
                onPick={(d) => {
                  useUi.getState().showDate(d);
                  setPicking(false);
                }}
                onClose={() => setPicking(false)}
              />
            )}
            {mode !== "month" && <span className="h1-note">Week {isoWeek(mode === "week" ? addDays(viewStart, 3) : viewStart)}</span>}
          </h1>
          <div className="toolbar-actions">
            <div className="segmented" role="radiogroup" aria-label="Calendar view">
              {MODES.map(([m, label, key]) =>
                m === "day" ? (
                  <DayButton key={m} on={mode === "day"} count={dayCount} />
                ) : (
                  <button key={m} role="radio" aria-checked={mode === m} className={mode === m ? "on" : ""} title={`${label} (${key})`} onClick={() => useUi.getState().setCalMode(m)}>
                    {label}
                  </button>
                ),
              )}
            </div>
            <button className="btn" onClick={() => useUi.getState().showDate(new Date())}>Today</button>
            <div className="btn-pair">
              <button className="btn icon-only" aria-label={`Previous ${stepWord}`} title={`Previous ${stepWord} (←)`} onClick={() => useUi.getState().stepCalendar(-1)}>
                <Icon name="left" />
              </button>
              <button className="btn icon-only" aria-label={`Next ${stepWord}`} title={`Next ${stepWord} (→)`} onClick={() => useUi.getState().stepCalendar(1)}>
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

/**
 * "Day" with a small menu for how many days side by side (1 to 14), from the day shown.
 * The button keeps the count chosen last; D always goes back to one day.
 */
function DayButton({ on, count }: { on: boolean; count: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", esc, true);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", esc, true);
    };
  }, [open]);
  const label = count === 1 ? "Day" : `${count} days`;
  return (
    <div className="day-button" ref={ref}>
      <button role="radio" aria-checked={on} className={on ? "on" : ""} title="Day (D), or 2 to 9 for that many days" onClick={() => useUi.getState().setDayCount(count)}>
        {label}
      </button>
      <button
        className={`day-more${open ? " open" : ""}`}
        aria-label="Number of days"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="chevron" size={11} />
      </button>
      {open && (
        <div className="menu days-menu" role="menu" aria-label="Number of days">
          <span className="days-menu-title">Number of days</span>
          <div className="days-grid">
            {Array.from({ length: MAX_DAYS }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                role="menuitemradio"
                aria-checked={on && count === n}
                className={on && count === n ? "on" : ""}
                onClick={() => {
                  useUi.getState().setDayCount(n);
                  setOpen(false);
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
