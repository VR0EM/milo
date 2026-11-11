import { useState } from "react";
import { api } from "../../lib/api";
import { useAction, useActiveFocus, useActivities, useSpaces, useTasks } from "../../lib/queries";
import { useUi } from "../../lib/store";
import { fmtClock, fmtDuration, fmtTime } from "../../lib/time";
import type { FocusSession } from "../../lib/types";
import { useNow } from "../../lib/useNow";

const PRESETS = [25, 45, 60, 90];

/** Right-hand panel of Today: set up a focus session, or watch the one that is running. */
export function FocusPanel() {
  const session = useActiveFocus().data ?? null;
  return (
    <aside className="panel" aria-label="Focus timer">
      {session ? <Running session={session} /> : <Setup />}
    </aside>
  );
}

function Setup() {
  const spaces = (useSpaces().data ?? []).filter((s) => !s.deletedAt);
  const activities = (useActivities().data ?? []).filter((a) => !a.deletedAt);
  const tasks = (useTasks().data ?? []).filter((t) => !t.completedAt);
  const lastSpaceId = useUi((s) => s.lastSpaceId);
  const act = useAction("focus");

  const [minutes, setMinutes] = useState(25);
  const [spaceId, setSpaceId] = useState(() => (spaces.find((s) => s.id === lastSpaceId) ?? spaces[0])?.id ?? "");
  const [activityId, setActivityId] = useState(() => activities.find((a) => a.category === "self_study")?.id ?? "");
  const [taskId, setTaskId] = useState("");

  const space = spaceId || spaces[0]?.id || "";
  const spaceTasks = tasks.filter((t) => t.spaceId === space);
  const task = spaceTasks.find((t) => t.id === taskId);
  const valid = !!space && minutes >= 1 && minutes <= 600;

  const start = () =>
    act.mutate(() => {
      useUi.getState().setLastSpace(space);
      return api.startFocus({
        spaceId: space,
        activityId: activityId || null,
        taskId: task?.id ?? null,
        title: task?.title ?? "",
        plannedMinutes: minutes,
      });
    });

  return (
    <form className="panel-form focus" onSubmit={(e) => e.preventDefault()}>
      <h2 className="panel-heading">Focus</h2>

      <fieldset className="field">
        <legend>Length</legend>
        <div className="presets">
          {PRESETS.map((m) => (
            <button key={m} type="button" className={`btn${minutes === m ? " on" : ""}`} onClick={() => setMinutes(m)}>
              {m}
            </button>
          ))}
          <input
            type="number"
            aria-label="Minutes"
            min={1}
            max={600}
            value={minutes || ""}
            onChange={(e) => setMinutes(Number(e.target.value))}
          />
          <span className="muted">min</span>
        </div>
      </fieldset>

      <label className="field">
        <span>Space</span>
        <select value={space} onChange={(e) => { setSpaceId(e.target.value); setTaskId(""); }}>
          {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>

      <label className="field">
        <span>Activity</span>
        <select value={activityId} onChange={(e) => setActivityId(e.target.value)}>
          <option value="">None</option>
          {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </label>

      <label className="field">
        <span>Task (optional)</span>
        <select value={task?.id ?? ""} onChange={(e) => setTaskId(e.target.value)} disabled={spaceTasks.length === 0}>
          <option value="">{spaceTasks.length ? "None" : "No open tasks in this space"}</option>
          {spaceTasks.map((t) => <option key={t.id} value={t.id}>{t.title || "Untitled"}</option>)}
        </select>
      </label>

      <button type="button" className="btn primary big" disabled={!valid} onClick={start}>Start focus</button>
      <p className="muted small">When you finish, the session is saved to the calendar with its real length.</p>
    </form>
  );
}

function Running({ session }: { session: FocusSession }) {
  const now = useNow(1000);
  const spaces = useSpaces().data ?? [];
  const act = useAction("focus", "events");
  const started = new Date(session.startedAt);
  const elapsed = now.getTime() - started.getTime();
  const planned = session.plannedMinutes * 60_000;
  const over = elapsed >= planned;
  const space = spaces.find((s) => s.id === session.spaceId);

  const finish = () =>
    act.mutate(async () => {
      await api.finishFocus(session.id);
      useUi.getState().notify({ text: `Focus session saved to the calendar · ${fmtDuration(Math.max(elapsed, 60_000))}` });
    });
  const discard = () =>
    act.mutate(async () => {
      await api.discardFocus(session.id);
      useUi.getState().notify({ text: "Focus session stopped without saving" });
    });

  return (
    <div className="panel-form focus">
      <h2 className="panel-heading">Focus</h2>
      <p className="muted">
        {session.title || "Focus"}{space ? ` · ${space.name}` : ""}
      </p>

      <div className="clock" role="timer" aria-label={over ? "Time over the planned length" : "Time left"}>
        {over ? `+${fmtClock(elapsed - planned)}` : fmtClock(planned - elapsed)}
      </div>
      <div className="progress neutral"><div style={{ width: `${Math.min(1, elapsed / planned) * 100}%` }} /></div>
      <p className="muted">
        {over ? `The planned ${session.plannedMinutes} minutes are done.` : `Started at ${fmtTime(started)} · ${session.plannedMinutes} min planned`}
      </p>

      <button type="button" className="btn primary big" onClick={finish}>{over ? "Finish and save" : "Stop and save"}</button>
      <button type="button" className="btn quiet" onClick={discard}>Stop without saving</button>
    </div>
  );
}
