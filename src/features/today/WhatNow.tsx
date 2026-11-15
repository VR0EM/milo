import { useMemo, useState } from "react";
import { colorVar } from "../../lib/colors";
import { beginFocus } from "../../lib/focus";
import { api } from "../../lib/api";
import { useAction, useActiveFocus, useActivities, useAllSpaces, useRoutineChecks, useRoutines, useTasks } from "../../lib/queries";
import { useUi } from "../../lib/store";
import { daysFromToday, fmtDuration, fmtHm, fmtRelativeDays, fmtTime, startOfDay, toDateInput } from "../../lib/time";
import { todayList } from "../../lib/today";
import type { CalEvent, Routine, Task } from "../../lib/types";
import { activeRoutine } from "./routines";
import { SpaceMark } from "../../components/Icon";

/** After this hour the day counts as done; "free time" stops there. */
const DAY_ENDS_AT = 22;
const PRIORITY_WEIGHT = { high: 3, medium: 1, low: 0 } as const;

/**
 * A plain score, lower first: overdue work, then the nearest deadline, pulled forward by
 * priority and by a personal aim of today. No hidden magic, so the reason can be shown.
 */
function score(t: Task, now: Date) {
  const days = t.deadlineAt ? daysFromToday(new Date(t.deadlineAt)) : 30;
  const overdue = !!t.deadlineAt && new Date(t.deadlineAt) < now;
  const aimToday = !!t.targetAt && daysFromToday(new Date(t.targetAt)) <= 0;
  return (overdue ? -100 : 0) + Math.min(days, 30) - (t.priority ? PRIORITY_WEIGHT[t.priority] : 0) - (aimToday ? 2 : 0);
}

function reason(t: Task, now: Date) {
  const parts: string[] = [];
  if (t.deadlineAt) {
    const d = new Date(t.deadlineAt);
    parts.push(d < now ? "overdue" : `due ${fmtRelativeDays(daysFromToday(d))}`);
  }
  if (t.targetAt && daysFromToday(new Date(t.targetAt)) <= 0) parts.push("you aimed for today");
  if (t.priority === "high") parts.push("high priority");
  return parts.join(" · ") || "no deadline";
}

/**
 * What to do now. While a routine runs (07:00–10:00, say) that is its checklist; otherwise one
 * suggestion for the free time, from Today's to-dos first, with the reason in plain words.
 */
export function WhatNow({ now, live }: { now: Date; live: CalEvent[] }) {
  const routines = useRoutines().data ?? [];
  const running = activeRoutine(routines, now);
  const [later, setLater] = useState<string | null>(null);
  if (running && later !== running.routine.id + running.day) {
    return <RoutineNow routine={running.routine} day={running.day} onSkip={() => setLater(running.routine.id + running.day)} />;
  }
  return <Suggestion now={now} live={live} />;
}

function RoutineNow({ routine, day, onSkip }: { routine: Routine; day: string; onSkip: () => void }) {
  const checked = useRoutineChecks(day).data ?? [];
  const act = useAction("routineChecks");
  const items = routine.items;
  const top = items.filter((i) => !i.parentId || !items.some((p) => p.id === i.parentId));
  const done = items.filter((i) => checked.includes(i.id)).length;
  const row = (id: string, title: string, sub: boolean) => {
    const on = checked.includes(id);
    return (
      <li key={id} className={sub ? "sub" : undefined}>
        <label className={`check routine-item${on ? " on" : ""}`}>
          <input
            type="checkbox"
            className="todo-check"
            checked={on}
            onChange={(e) => {
              const value = e.target.checked;
              act.mutate(() => api.setRoutineCheck(id, day, value));
            }}
          />
          <span>{title}</span>
        </label>
      </li>
    );
  };
  return (
    <section className="block what-now">
      <div className="block-head">
        <h2>What now?</h2>
        <span className="muted small">{routine.name} until {fmtHm(routine.endTime)}</span>
        <span className="spacer" />
        <button className="link" onClick={() => useUi.setState({ routineEditId: routine.id })}>Edit</button>
      </div>
      {items.length === 0 ? (
        <p className="muted">This routine has no steps yet. Use Edit to add them.</p>
      ) : (
        <>
          <span className="muted small">{done} of {items.length} done</span>
          <ul className="routine-list">
            {top.flatMap((i) => [row(i.id, i.title, false), ...items.filter((c) => c.parentId === i.id).map((c) => row(c.id, c.title, true))])}
          </ul>
        </>
      )}
      <button className="link" onClick={onSkip}>Show a to-do instead</button>
    </section>
  );
}

function Suggestion({ now, live }: { now: Date; live: CalEvent[] }) {
  const tasks = useTasks().data ?? [];
  const spaces = useAllSpaces().data ?? [];
  const activities = useActivities().data ?? [];
  const focus = useActiveFocus().data ?? null;
  const act = useAction("focus");
  const [skip, setSkip] = useState(0);

  const timed = live.filter((e) => !e.allDay);
  const current = timed.filter((e) => new Date(e.startAt) <= now && new Date(e.endAt) > now);
  const busyUntil = current.reduce((t, e) => Math.max(t, new Date(e.endAt).getTime()), now.getTime());
  const dayEnd = startOfDay(now).getTime() + DAY_ENDS_AT * 3_600_000;
  const nextEvent = timed.find((e) => new Date(e.startAt).getTime() >= busyUntil) ?? null;
  const freeUntil = Math.min(nextEvent ? new Date(nextEvent.startAt).getTime() : dayEnd, dayEnd);
  const freeMin = Math.max(0, Math.round((freeUntil - busyUntil) / 60_000));

  // What was picked for today comes first; with nothing picked, every open to-do.
  const candidates = useMemo(() => {
    const picked = todayList(tasks, now).filter((t) => !t.completedAt);
    const pool = picked.length ? picked : tasks.filter((t) => !t.completedAt);
    return pool.sort((a, b) => score(a, now) - score(b, now) || a.title.localeCompare(b.title));
  }, [tasks, now]);
  if (focus) return null;

  // A block planned for a task right now comes first.
  const plannedNow = current.find((e) => e.taskId);
  const task = plannedNow ? tasks.find((t) => t.id === plannedNow.taskId) : candidates.length ? candidates[skip % candidates.length] : null;
  const space = task ? spaces.find((s) => s.id === task.spaceId) : null;
  const studyId = activities.find((a) => a.category === "self_study" && !a.deletedAt)?.id ?? null;
  const minutes = Math.max(5, Math.min(50, Math.floor(freeMin / 5) * 5));

  const when =
    busyUntil > now.getTime() && current.length
      ? `Busy until ${fmtTime(new Date(busyUntil))}. `
      : "";
  const free =
    freeMin <= 0
      ? "No free time left today."
      : nextEvent && new Date(nextEvent.startAt).getTime() <= dayEnd
        ? `${fmtDuration(freeMin * 60_000)} free until ${nextEvent.title || "your next event"} at ${fmtTime(new Date(nextEvent.startAt))}.`
        : `Free for the rest of the day.`;

  const start = () => {
    if (!task) return;
    act.mutate(() =>
      beginFocus(
        plannedNow
          ? {
              spaceId: plannedNow.spaceId, activityId: plannedNow.activityId, taskId: task.id, title: plannedNow.title,
              plannedMinutes: Math.max(1, Math.round((new Date(plannedNow.endAt).getTime() - now.getTime()) / 60_000)),
              eventId: plannedNow.id,
            }
          : { spaceId: task.spaceId, activityId: studyId, taskId: task.id, title: task.title, plannedMinutes: minutes },
      ),
    );
  };
  const plan = () => {
    if (!task) return;
    const ui = useUi.getState();
    ui.setView("calendar");
    if (ui.calMode === "month") ui.setCalMode("week");
    ui.showDate(now);
    useUi.setState({ planTaskId: task.id });
  };

  // Nothing to suggest: the block stays away instead of saying so.
  if (!task) return null;

  return (
    <section className="block what-now">
      <div className="block-head">
        <h2>What now?</h2>
        <span className="muted small">{when}{free}</span>
      </div>
      {!task ? (
        <p className="muted">No open tasks. The free time is yours.</p>
      ) : (
        <div className="suggestion" style={{ ["--c" as string]: colorVar(space?.color ?? "gray") }}>
          <div className="suggestion-main">
            <SpaceMark icon={space?.icon} size={16} />
            <div className="suggestion-text">
              <div className="suggestion-title">{task.title || "Untitled"}</div>
              <div className="muted small">
                {plannedNow ? "You planned this for now" : task.todayOn === toDateInput(now) ? `on Today · ${reason(task, now)}` : reason(task, now)}
                {space ? ` · ${space.name}` : ""}
              </div>
            </div>
          </div>
          <div className="suggestion-actions">
            <button className="btn primary" onClick={start} disabled={!plannedNow && freeMin <= 0}>
              {plannedNow ? "Start focus" : `Focus ${minutes} min`}
            </button>
            {!plannedNow && <button className="btn" onClick={plan}>Plan it</button>}
            {!plannedNow && candidates.length > 1 && (
              <button className="link" onClick={() => setSkip((n) => n + 1)}>Something else</button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
