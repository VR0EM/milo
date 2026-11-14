import { useMemo } from "react";
import { api } from "../../lib/api";
import { colorVar } from "../../lib/colors";
import { useAction, useActivities, useEvents, useGroups, useInsights, useSpaces, useTaskTypes, useTasks } from "../../lib/queries";
import { useUi } from "../../lib/store";
import { addDays, daysFromToday, fmtDuration, fmtRange, fmtRelativeDays, startOfDay, startOfWeek, toDateInput } from "../../lib/time";
import { taskProgress, type CalEvent, type Insights, type Task } from "../../lib/types";
import { useNow } from "../../lib/useNow";
import { SpaceMark } from "../../components/Icon";
import { fmtMinutes } from "../insights/Charts";
import { deadlineLine } from "../tasks/TasksView";
import { TaskPanel } from "../tasks/TaskPanel";

const AHEAD_DAYS = 14;
const BACK_DAYS = 30;
const LIST_MAX = 8;

const shortDay = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });
/** "Today", "Tomorrow", "Yesterday", or "Mon 16 Nov". */
function dayLabel(d: Date) {
  const n = daysFromToday(d);
  return Math.abs(n) <= 1 ? fmtRelativeDays(n).replace(/^./, (c) => c.toUpperCase()) : shortDay.format(d);
}

/** Minutes this space got in a period, and how much of it was productive. */
function spaceTime(data: Insights | undefined, spaceId: string) {
  const row = data?.spaces.find((s) => s.spaceId === spaceId);
  if (!row) return { total: 0, productive: 0 };
  return { total: row.class + row.selfStudy + row.other + row.sleep, productive: row.class + row.selfStudy };
}

/** One space at a glance: its time, what is coming, its open tasks and what happened lately. */
export function SpaceView() {
  const spaceId = useUi((s) => s.spaceViewId);
  const spaces = useSpaces().data ?? [];
  const groups = useGroups().data ?? [];
  const activities = useActivities().data ?? [];
  const types = useTaskTypes().data ?? [];
  const allTasks = useTasks().data ?? [];
  const selectedTaskId = useUi((s) => s.selectedTaskId);
  const act = useAction("tasks");
  const now = useNow(60_000);

  const today = startOfDay(now);
  const weekFrom = startOfWeek(today);
  const monthFrom = new Date(today.getFullYear(), today.getMonth(), 1);
  const week = useInsights(toDateInput(weekFrom), toDateInput(addDays(weekFrom, 7))).data;
  const monthData = useInsights(toDateInput(monthFrom), toDateInput(new Date(today.getFullYear(), today.getMonth() + 1, 1))).data;
  const events = useEvents(addDays(today, -BACK_DAYS), addDays(today, AHEAD_DAYS + 1)).data ?? [];

  const space = spaces.find((s) => s.id === spaceId);
  const activityById = useMemo(() => new Map(activities.map((a) => [a.id, a])), [activities]);

  const mine = useMemo(() => events.filter((e) => e.spaceId === spaceId), [events, spaceId]);
  const coming = mine
    .filter((e) => new Date(e.endAt) > now && e.status !== "skipped")
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const recent = mine
    .filter((e) => new Date(e.endAt) <= now)
    .sort((a, b) => b.startAt.localeCompare(a.startAt))
    .slice(0, LIST_MAX);
  const tasks = allTasks.filter((t) => t.spaceId === spaceId);
  const open = tasks
    .filter((t) => !t.completedAt)
    .sort((a, b) => (a.deadlineAt ?? "9999").localeCompare(b.deadlineAt ?? "9999") || a.title.localeCompare(b.title));
  const doneCount = tasks.length - open.length;
  const nextDeadline = open.find((t) => t.deadlineAt);
  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;

  if (!space || space.deletedAt) {
    return (
      <main className="page full">
        <header className="toolbar"><h1>Space</h1></header>
        <div className="page-scroll">
          <p className="muted">This space is archived or no longer exists.</p>
        </div>
      </main>
    );
  }

  const thisWeek = spaceTime(week, space.id);
  const thisMonth = spaceTime(monthData, space.id);
  const group = groups.find((g) => g.id === space.groupId);

  const openEvent = (e: CalEvent) => {
    const ui = useUi.getState();
    ui.setView("calendar");
    ui.setCalMode("day");
    ui.showDate(new Date(e.startAt));
    ui.select(e.id);
  };
  const newTask = () =>
    act.mutate(
      () => api.createTask({ spaceId: space.id, typeId: null, title: "", notes: "", deadlineAt: null, targetAt: null, priority: null }),
      { onSuccess: (t) => useUi.getState().selectTask((t as Task).id, true) },
    );

  const eventRow = (e: CalEvent, past: boolean) => {
    const start = new Date(e.startAt);
    const end = new Date(e.endAt);
    const activity = e.activityId ? activityById.get(e.activityId)?.name : null;
    return (
      <li key={e.id}>
        <button className={`space-row${e.status === "skipped" ? " skipped" : ""}`} onClick={() => openEvent(e)}>
          <span className="space-when">{dayLabel(start)}</span>
          <span className="space-time muted tabular">{e.allDay ? "All day" : fmtRange(start, end)}</span>
          <span className="space-title">{e.title || "Untitled"}</span>
          <span className="spacer" />
          <span className="muted small">
            {[activity, e.status === "skipped" ? "did not happen" : past && !e.allDay ? fmtDuration(end.getTime() - start.getTime()) : null]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </button>
      </li>
    );
  };

  return (
    <>
      <main className={`page space-page${selectedTask ? "" : " full"}`} style={{ ["--c" as string]: colorVar(space.color) }}>
        <header className="toolbar">
          <h1>
            <SpaceMark icon={space.icon} size={18} />
            {space.name}
            {group && <span className="h1-note">{group.name}</span>}
          </h1>
          <div className="toolbar-actions">
            <button className="btn" onClick={() => useUi.getState().openDialog({ kind: "space", item: space })}>Edit</button>
          </div>
        </header>

        <div className="page-scroll">
          <div className="stats">
            <div className="stat">
              <div className="stat-label">This week</div>
              <div className="stat-value">{fmtMinutes(thisWeek.total)}</div>
              <div className="stat-note">{thisWeek.productive ? `${fmtMinutes(thisWeek.productive)} productive` : "in the calendar so far"}</div>
            </div>
            <div className="stat">
              <div className="stat-label">This month</div>
              <div className="stat-value">{fmtMinutes(thisMonth.total)}</div>
              <div className="stat-note">{thisMonth.productive ? `${fmtMinutes(thisMonth.productive)} productive` : "in the calendar so far"}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Open tasks</div>
              <div className="stat-value">{open.length}</div>
              <div className="stat-note">{doneCount} done</div>
            </div>
            <div className="stat">
              <div className="stat-label">Next deadline</div>
              <div className={`stat-value${nextDeadline && deadlineLine(nextDeadline)?.late ? " late" : ""}`}>
                {nextDeadline ? fmtRelativeDays(daysFromToday(new Date(nextDeadline.deadlineAt!))) : "–"}
              </div>
              <div className="stat-note ellipsis">{nextDeadline ? nextDeadline.title || "Untitled" : "nothing due"}</div>
            </div>
          </div>

          <section className="block">
            <div className="block-head">
              <h2>Coming up</h2>
              <span className="muted small">next {AHEAD_DAYS} days</span>
            </div>
            {coming.length === 0 ? <p className="muted">Nothing planned.</p> : <ul className="space-list">{coming.slice(0, LIST_MAX).map((e) => eventRow(e, false))}</ul>}
            {coming.length > LIST_MAX && <p className="muted small">{coming.length - LIST_MAX} more in the calendar.</p>}
          </section>

          <section className="block">
            <div className="block-head">
              <h2>Tasks</h2>
              <span className="spacer" />
              <button className="btn small" onClick={newTask}>New task</button>
            </div>
            {open.length === 0 ? (
              <p className="muted">No open tasks.</p>
            ) : (
              <ul className="space-list">
                {open.map((t) => {
                  const due = deadlineLine(t);
                  const pct = Math.round(taskProgress(t) * 100);
                  return (
                    <li key={t.id}>
                      <button className={`space-row${t.id === selectedTaskId ? " selected" : ""}`} onClick={() => useUi.getState().selectTask(t.id)}>
                        <span className="space-title">{t.title || "Untitled"}</span>
                        <span className="spacer" />
                        <span className="space-progress" aria-label={`${pct}% done`}>
                          <span className="progress"><span style={{ width: `${pct}%` }} /></span>
                          <span className="muted small tabular">{pct}%</span>
                        </span>
                        <span className={`space-due small ${due?.late ? "late" : "muted"}`}>{due ? due.text : "No deadline"}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="block">
            <div className="block-head">
              <h2>Recently</h2>
              <span className="muted small">last {BACK_DAYS} days</span>
            </div>
            {recent.length === 0 ? <p className="muted">Nothing in the last {BACK_DAYS} days.</p> : <ul className="space-list">{recent.map((e) => eventRow(e, true))}</ul>}
          </section>
        </div>
      </main>
      {selectedTask && <TaskPanel task={selectedTask} spaces={spaces} types={types} />}
    </>
  );
}
