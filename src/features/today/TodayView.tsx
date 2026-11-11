import { useMemo } from "react";
import { api } from "../../lib/api";
import { colorVar } from "../../lib/colors";
import { useAction, useEvents, useRoutineChecks, useRoutines, useSpaces, useTasks } from "../../lib/queries";
import { useUi } from "../../lib/store";
import { addDays, daysFromToday, fmtDuration, fmtLongDay, fmtRange, fmtTime, startOfDay, toDateInput } from "../../lib/time";
import { taskProgress, type CalEvent, type Space } from "../../lib/types";
import { useNow } from "../../lib/useNow";
import { deadlineLine } from "../tasks/TasksView";
import { FocusPanel } from "./FocusPanel";
import { RoutineEditor } from "./RoutineEditor";
import { activeRoutine, nextRoutine } from "./routines";

const DEADLINE_WINDOW_DAYS = 14;

export function TodayView() {
  const now = useNow(15_000);
  const dayStart = useMemo(() => startOfDay(now), [toDateInput(now)]); // eslint-disable-line react-hooks/exhaustive-deps
  const dayEnd = useMemo(() => addDays(dayStart, 2), [dayStart]);

  const spaces = useSpaces().data ?? [];
  const events = useEvents(dayStart, dayEnd).data ?? [];
  const tasks = useTasks().data ?? [];
  const routines = useRoutines().data ?? [];

  const spaceById = useMemo(() => new Map(spaces.map((s) => [s.id, s])), [spaces]);
  const live = events.filter((e) => e.status !== "skipped" && !e.allDay);
  const current = live.filter((e) => new Date(e.startAt) <= now && new Date(e.endAt) > now);
  const next = live.find((e) => new Date(e.startAt) > now) ?? null;

  const deadlines = tasks
    .filter((t) => !t.completedAt && t.deadlineAt && daysFromToday(new Date(t.deadlineAt)) <= DEADLINE_WINDOW_DAYS)
    .sort((a, b) => a.deadlineAt!.localeCompare(b.deadlineAt!));

  return (
    <>
      <main className="page">
        <header className="toolbar">
          <h1>
            {fmtLongDay(now)}
            <span className="h1-note tabular">{fmtTime(now)}</span>
          </h1>
        </header>
        <div className="page-scroll">
          <section className="block">
            <h2>Now</h2>
            {current.length === 0 && <p className="muted">Nothing planned right now.</p>}
            {current.map((e) => <EventLine key={e.id} event={e} space={spaceById.get(e.spaceId)} now={now} kind="now" />)}
            <h2 className="sub">Next</h2>
            {next ? <EventLine event={next} space={spaceById.get(next.spaceId)} now={now} kind="next" />
              : <p className="muted">Nothing else planned today or tomorrow.</p>}
          </section>

          <RoutineBlock now={now} />

          <section className="block">
            <h2>Deadlines</h2>
            {deadlines.length === 0 && <p className="muted">No deadlines in the next {DEADLINE_WINDOW_DAYS} days.</p>}
            <ul className="deadline-list">
              {deadlines.map((t) => {
                const due = deadlineLine(t)!;
                const pct = Math.round(taskProgress(t) * 100);
                return (
                  <li key={t.id}>
                    <button
                      className="deadline-row"
                      style={{ ["--c" as string]: colorVar(spaceById.get(t.spaceId)?.color ?? "gray") }}
                      onClick={() => {
                        useUi.getState().setView("tasks");
                        useUi.getState().selectTask(t.id);
                      }}
                    >
                      <span className="swatch big-sq" />
                      <span className="deadline-title">{t.title || "Untitled"}</span>
                      <span className="muted">{spaceById.get(t.spaceId)?.name}</span>
                      <span className="spacer" />
                      <span className="muted">{pct}%</span>
                      <span className={due.late ? "late" : ""}>{due.text}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </main>
      <FocusPanel />
      <RoutineEditor routines={routines} />
    </>
  );
}

function EventLine({ event, space, now, kind }: { event: CalEvent; space?: Space; now: Date; kind: "now" | "next" }) {
  const start = new Date(event.startAt);
  const end = new Date(event.endAt);
  const total = end.getTime() - start.getTime();
  const done = Math.min(1, Math.max(0, (now.getTime() - start.getTime()) / total));
  const tomorrow = daysFromToday(start) === 1;
  return (
    <div className={`event-line ${kind}`} style={{ ["--c" as string]: colorVar(space?.color ?? "gray") }}>
      <div className="event-line-head">
        <span className="swatch big-sq" />
        <span className="event-line-title">{event.title || "Untitled"}</span>
        <span className="spacer" />
        <span className="muted tabular">
          {kind === "now" ? `${fmtDuration(end.getTime() - now.getTime())} left` : `${tomorrow ? "tomorrow" : "in"} ${tomorrow ? fmtTime(start) : fmtDuration(start.getTime() - now.getTime())}`}
        </span>
      </div>
      <div className="muted event-line-meta">
        {fmtRange(start, end)}
        {space ? ` · ${space.name}` : ""}
      </div>
      {kind === "now" && (
        <div className="progress thin" role="progressbar" aria-label="Time passed" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(done * 100)}>
          <div style={{ width: `${done * 100}%` }} />
        </div>
      )}
    </div>
  );
}

function RoutineBlock({ now }: { now: Date }) {
  const routines = useRoutines().data ?? [];
  const active = activeRoutine(routines, now);
  const upcoming = nextRoutine(routines, now);
  const day = active?.day ?? toDateInput(now);
  const checked = useRoutineChecks(day).data ?? [];
  const act = useAction("routineChecks");
  const openEditor = (id: string) => useUi.setState({ routineEditId: id });
  const addRoutine = useAction("routines");

  return (
    <section className="block">
      <div className="block-head">
        <h2>{active ? `${active.routine.name} routine` : "Routine"}</h2>
        {active && (
          <span className="muted">
            {active.routine.items.filter((i) => checked.includes(i.id)).length} of {active.routine.items.length}
          </span>
        )}
        <span className="spacer" />
        {active && <button className="link" onClick={() => openEditor(active.routine.id)}>Edit</button>}
      </div>

      {active ? (
        active.routine.items.length ? (
          <ul className="routine-list">
            {active.routine.items.map((item) => {
              const on = checked.includes(item.id);
              return (
                <li key={item.id}>
                  <label className={`check routine-item${on ? " on" : ""}`}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) => {
                        const value = e.target.checked;
                        act.mutate(() => api.setRoutineCheck(item.id, day, value));
                      }}
                    />
                    <span>{item.title}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">This routine has no steps yet. Use Edit to add them.</p>
        )
      ) : (
        <p className="muted">
          No routine right now.{upcoming ? ` Next: ${upcoming.name} at ${upcoming.startTime}.` : ""}
        </p>
      )}

      <div className="routine-all">
        <span className="muted">All routines:</span>
        {routines.map((r) => (
          <button key={r.id} className="link" onClick={() => openEditor(r.id)}>
            {r.name} {r.startTime}–{r.endTime}
          </button>
        ))}
        <button
          className="link"
          onClick={() =>
            addRoutine.mutate(async () => {
              const r = await api.createRoutine({ name: "New routine", startTime: "12:00", endTime: "13:00", weekdays: "1234567" });
              openEditor(r.id);
            })
          }
        >
          New routine
        </button>
      </div>
    </section>
  );
}
