// Focus: pick what to work on, run the timer, tick to-dos off as they are done. Stopping writes
// the session to the calendar as time per to-do (repo.rs finish_focus_at): the event is called
// after the to-do, never just "Focus".

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { colorVar } from "../../lib/colors";
import { endFocus } from "../../lib/focus";
import { pickDefaultSpace } from "../../lib/spaces";
import { useAction, useActiveFocus, useActivities, useAllSpaces, useSpaces, useTasks } from "../../lib/queries";
import { preferredSpace, useUi } from "../../lib/store";
import { fmtClock, fmtDuration, fmtTime } from "../../lib/time";
import { todayList } from "../../lib/today";
import { INBOX_ID, type FocusSession, type Space, type Task } from "../../lib/types";
import { useNow } from "../../lib/useNow";
import { SpaceChip } from "../tasks/Todo";

const PRESETS = [15, 30, 45, 60];

export function FocusView() {
  const session = useActiveFocus().data ?? null;
  return (
    <main className="page full focus-page">
      <header className="toolbar">
        <h1>Focus</h1>
      </header>
      <div className="page-scroll">{session ? <Running session={session} /> : <Setup />}</div>
    </main>
  );
}

function Setup() {
  const spaces = (useSpaces().data ?? []).filter((s) => !s.deletedAt);
  const allSpaces = useAllSpaces().data ?? [];
  const spaceById = useMemo(() => new Map(allSpaces.map((s) => [s.id, s])), [allSpaces]);
  const activities = (useActivities().data ?? []).filter((a) => !a.deletedAt);
  const open = (useTasks().data ?? []).filter((t) => !t.completedAt);
  const lastSpaceId = useUi(preferredSpace);
  const focusMini = useUi((s) => s.prefs.focusMini);
  const act = useAction("focus");

  const [minutes, setMinutes] = useState(30);
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [spaceId, setSpaceId] = useState("");
  // Study until another is chosen (the list may arrive after the screen).
  const [chosenActivity, setActivityId] = useState<string | null>(null);
  const activityId = chosenActivity ?? activities.find((a) => a.category === "self_study")?.id ?? "";

  const today = todayList(open, new Date());
  const q = query.trim().toLowerCase();
  const found = q ? open.filter((t) => t.title.toLowerCase().includes(q) && !today.includes(t)).slice(0, 8) : [];
  const pickedTasks = picked.map((id) => open.find((t) => t.id === id)).filter((t): t is Task => !!t);
  // The space follows the first to-do picked (unless it is in the Inbox), until one is chosen.
  const fromTask = pickedTasks.find((t) => t.spaceId !== INBOX_ID)?.spaceId;
  const space = spaceId || fromTask || pickDefaultSpace(spaces, lastSpaceId)?.id || "";
  const valid = !!space && minutes >= 1 && minutes <= 600;
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const start = () =>
    act.mutate(async () => {
      useUi.getState().setLastSpace(space);
      const session = await api.startFocus({
        spaceId: space,
        activityId: activityId || null,
        taskId: picked[0] ?? null,
        title: "",
        plannedMinutes: minutes,
        taskIds: picked,
      });
      if (useUi.getState().prefs.focusMini) api.showFocusMini().catch(() => {});
      return session;
    });

  const row = (t: Task) => (
    <li key={t.id}>
      <label className={`check focus-pick${picked.includes(t.id) ? " on" : ""}`}>
        <input type="checkbox" className="todo-check" checked={picked.includes(t.id)} onChange={() => toggle(t.id)} />
        <span className="focus-pick-title">{t.title || "Untitled"}</span>
        <SpaceChip space={spaceById.get(t.spaceId)} spaceId={t.spaceId} />
      </label>
    </li>
  );

  return (
    <>
      <section className="block focus-what" aria-labelledby="what-h">
        <h2 id="what-h">What will you work on?</h2>
        {pickedTasks.length > 0 && <ul className="focus-picks">{pickedTasks.map(row)}</ul>}
        {today.filter((t) => !picked.includes(t.id)).length > 0 && (
          <>
            <h3 className="focus-sub">On Today</h3>
            <ul className="focus-picks">{today.filter((t) => !picked.includes(t.id)).map(row)}</ul>
          </>
        )}
        <input
          type="search"
          className="search wide"
          placeholder="Find another to-do"
          aria-label="Find a to-do to work on"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {found.filter((t) => !picked.includes(t.id)).length > 0 && (
          <ul className="focus-picks">{found.filter((t) => !picked.includes(t.id)).map(row)}</ul>
        )}
      </section>

      <section className="block focus-how" aria-label="Length, space and activity">
        <fieldset className="field">
          <legend>Length</legend>
          <div className="presets">
            {PRESETS.map((m) => (
              <button key={m} type="button" className={`btn${minutes === m ? " on" : ""}`} onClick={() => setMinutes(m)}>
                {m}
              </button>
            ))}
            <input type="number" aria-label="Minutes" min={1} max={600} value={minutes || ""} onChange={(e) => setMinutes(Number(e.target.value))} />
            <span className="muted">min</span>
          </div>
        </fieldset>
        <div className="field-row">
          <label className="field">
            <span>Space</span>
            <select value={space} onChange={(e) => setSpaceId(e.target.value)}>
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
        </div>
        <button type="button" className="btn primary big" disabled={!valid} onClick={start}>Start focus</button>
        <label className="check small">
          <input type="checkbox" checked={focusMini} onChange={(e) => useUi.getState().setPrefs({ focusMini: e.target.checked })} />
          <span>Keep a small timer on top of other apps</span>
        </label>
      </section>
    </>
  );
}

function Running({ session }: { session: FocusSession }) {
  const now = useNow(1000);
  const spaces = useAllSpaces().data ?? [];
  const tasks = useTasks().data ?? [];
  const qc = useQueryClient();
  const act = useAction("focus", "events", "tasks");
  const picked = useQuery({ queryKey: ["focusTasks", session.id], queryFn: () => api.focusTasks(session.id) }).data ?? [];
  const started = new Date(session.startedAt);
  const elapsed = now.getTime() - started.getTime();
  const planned = session.plannedMinutes * 60_000;
  const over = elapsed >= planned;
  const space: Space | undefined = spaces.find((s) => s.id === session.spaceId);

  // How long each ticked to-do took: from the start, or from the one ticked before it.
  const ticks = picked.filter((p) => p.doneAt).map((p) => p.doneAt!).sort();
  const tookFor = (doneAt: string) => {
    const before = ticks.filter((t) => t < doneAt).pop() ?? session.startedAt;
    const ms = new Date(doneAt).getTime() - new Date(before).getTime();
    return ms < 60_000 ? "< 1 min" : fmtDuration(ms);
  };
  const tick = (taskId: string, done: boolean) =>
    act.mutate(async () => {
      await api.setFocusTaskDone(session.id, taskId, done);
      qc.invalidateQueries({ queryKey: ["focusTasks", session.id] });
    });
  const finish = () =>
    act.mutate(async () => {
      const kept = await endFocus(session);
      useUi.getState().notify({
        text: kept ? `Saved to the calendar · ${fmtDuration(elapsed)}` : "Stopped within a minute, so nothing was added to the calendar",
      });
    });
  const discard = () =>
    act.mutate(async () => {
      // No notice: she chose this, and the timer is gone.
      await api.discardFocus(session.id);
    });

  return (
    <section className="block focus-running" style={{ ["--c" as string]: colorVar(space?.color ?? "gray") }}>
      <p className="muted">{space?.name ?? "Focus"} · started at {fmtTime(started)} · {session.plannedMinutes} min planned</p>
      <div className="clock" role="timer" aria-label={over ? "Time over the planned length" : "Time left"}>
        {over ? `+${fmtClock(elapsed - planned)}` : fmtClock(planned - elapsed)}
      </div>
      <div className="progress neutral"><div style={{ width: `${Math.min(1, elapsed / planned) * 100}%` }} /></div>
      {over && <p className="muted">The planned {session.plannedMinutes} minutes are done.</p>}

      {picked.length > 0 && (
        <ul className="focus-picks running">
          {picked.map((p) => {
            const t = tasks.find((x) => x.id === p.taskId);
            return (
              <li key={p.taskId}>
                <label className={`check focus-pick${p.doneAt ? " done" : ""}`}>
                  <input type="checkbox" className="todo-check" checked={!!p.doneAt} onChange={(e) => tick(p.taskId, e.target.checked)} />
                  <span className="focus-pick-title">{t?.title || "Untitled"}</span>
                  {p.doneAt && <span className="muted small tabular">{tookFor(p.doneAt)}</span>}
                </label>
              </li>
            );
          })}
        </ul>
      )}

      <div className="focus-actions">
        <button type="button" className="btn primary big" onClick={finish}>{over ? "Finish and save" : "Stop and save"}</button>
        <button type="button" className="btn" onClick={() => api.showFocusMini().catch(() => {})}>Show small timer</button>
        <button type="button" className="btn quiet" onClick={discard}>Stop without saving</button>
      </div>
    </section>
  );
}
