import { useEffect, useMemo } from "react";
import { api } from "../../lib/api";
import { colorVar } from "../../lib/colors";
import { useSpaces, useTaskAction, useTaskTypes, useTasks } from "../../lib/queries";
import { useUi } from "../../lib/store";
import { daysFromToday, fmtMoment, fmtRelativeDays } from "../../lib/time";
import { taskProgress, type Task, type TaskType } from "../../lib/types";
import { ignoreForShortcut } from "../shortcuts/keys";
import { TaskPanel } from "./TaskPanel";

const VISIBLE_PARTS = 5;

/** Open tasks first, the nearest deadline on top; tasks without a deadline last. */
function byUrgency(a: Task, b: Task) {
  if (!!a.completedAt !== !!b.completedAt) return a.completedAt ? 1 : -1;
  const da = a.deadlineAt ?? a.targetAt ?? "9999";
  const db = b.deadlineAt ?? b.targetAt ?? "9999";
  return da.localeCompare(db) || a.sortOrder - b.sortOrder;
}

export function TasksView() {
  const spaces = useSpaces().data ?? [];
  const types = useTaskTypes().data ?? [];
  const tasks = useTasks().data ?? [];
  const hidden = useUi((s) => s.hiddenSpaceIds);
  const lastSpaceId = useUi((s) => s.lastSpaceId);
  const selectedId = useUi((s) => s.selectedTaskId);
  const showCompleted = useUi((s) => s.showCompleted);
  const act = useTaskAction();

  const active = spaces.filter((s) => !s.deletedAt);
  const defaultSpaceId = (active.find((s) => s.id === lastSpaceId) ?? active[0])?.id ?? null;
  const selected = tasks.find((t) => t.id === selectedId) ?? null;
  const completedCount = tasks.filter((t) => t.completedAt && !hidden.includes(t.spaceId)).length;

  const sections = useMemo(() => {
    const shown = tasks.filter((t) => !hidden.includes(t.spaceId) && (showCompleted || !t.completedAt));
    return spaces
      .map((space) => ({ space, tasks: shown.filter((t) => t.spaceId === space.id).sort(byUrgency) }))
      .filter((s) => s.tasks.length > 0);
  }, [tasks, spaces, hidden, showCompleted]);

  const newTask = (spaceId: string | null) => {
    if (!spaceId) return;
    act.mutate(
      () => api.createTask({ spaceId, typeId: null, title: "", notes: "", deadlineAt: null, targetAt: null }),
      { onSuccess: (t) => useUi.getState().selectTask(t.id, true) },
    );
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ignoreForShortcut(e)) return;
      if (e.key === "n") {
        e.preventDefault();
        newTask(defaultSpaceId);
      } else if (e.key === "Escape") useUi.getState().selectTask(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <>
      <main className="tasks" onClick={(e) => e.target === e.currentTarget && useUi.getState().selectTask(null)}>
        <header className="toolbar">
          <h1>Tasks</h1>
          <div className="toolbar-actions">
            {completedCount > 0 && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={showCompleted}
                  onChange={(e) => useUi.getState().setShowCompleted(e.target.checked)}
                />
                <span>Show completed ({completedCount})</span>
              </label>
            )}
            <button className="btn" disabled={!defaultSpaceId} onClick={() => newTask(defaultSpaceId)}>New task</button>
          </div>
        </header>

        <div className="tasks-scroll">
          {sections.length === 0 && (
            <p className="panel-empty">No open tasks. Use "New task" to add one.</p>
          )}
          {sections.map(({ space, tasks }) => (
            <section key={space.id} className="task-section" style={{ ["--c" as string]: colorVar(space.color) }}>
              <div className="task-section-head">
                <span className="swatch big-sq" />
                <h2>{space.name}</h2>
                <span className="muted">{summary(tasks)}</span>
                <span className="spacer" />
                <button className="link" onClick={() => newTask(space.id)}>Add task</button>
              </div>
              <div className="task-cards">
                {tasks.map((t) => (
                  <TaskCard key={t.id} task={t} type={types.find((x) => x.id === t.typeId)} selected={t.id === selectedId} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
      <TaskPanel task={selected} spaces={spaces} types={types} />
    </>
  );
}

function summary(tasks: Task[]) {
  const open = tasks.filter((t) => !t.completedAt).length;
  return open === 0 ? "all done" : `${open} open`;
}

export function deadlineLine(task: Task): { text: string; late: boolean } | null {
  if (!task.deadlineAt) return null;
  const d = new Date(task.deadlineAt);
  const late = !task.completedAt && d.getTime() < Date.now();
  return { text: `Due ${fmtMoment(d)} · ${fmtRelativeDays(daysFromToday(d))}`, late };
}

function TaskCard({ task, type, selected }: { task: Task; type?: TaskType; selected: boolean }) {
  const act = useTaskAction();
  const progress = taskProgress(task);
  const done = task.parts.filter((p) => p.doneAt).length;
  const open = task.parts.filter((p) => !p.doneAt);
  const due = deadlineLine(task);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <article
      className={`task-card${selected ? " selected" : ""}${task.completedAt ? " done" : ""}`}
      onClick={() => useUi.getState().selectTask(task.id)}
    >
      <div className="task-card-top">
        <span className="task-type">{type?.name ?? "Task"}</span>
        <span className="task-pct">{Math.round(progress * 100)}%</span>
      </div>

      <div className="task-title-row">
        {task.parts.length === 0 && (
          <input
            type="checkbox"
            aria-label="Completed"
            checked={!!task.completedAt}
            onClick={stop}
            onChange={(e) => {
              const completed = e.target.checked;
              act.mutate(() => api.setTaskCompleted(task.id, completed));
            }}
          />
        )}
        <h3>{task.title || "Untitled"}</h3>
      </div>

      <div
        className="progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        <div style={{ width: `${progress * 100}%` }} />
      </div>

      {task.parts.length > 0 && (
        <>
          <p className="muted">{done} of {task.parts.length} parts done</p>
          {open.length > 0 && (
            <ul className="card-parts">
              {open.slice(0, VISIBLE_PARTS).map((p) => (
                <li key={p.id}>
                  <label className="check" onClick={stop}>
                    <input type="checkbox" checked={false} onChange={() => act.mutate(() => api.setPartDone(p.id, true))} />
                    <span>{p.title}</span>
                  </label>
                </li>
              ))}
              {open.length > VISIBLE_PARTS && <li className="muted">and {open.length - VISIBLE_PARTS} more</li>}
            </ul>
          )}
        </>
      )}

      {(due || task.targetAt) && (
        <div className="task-dates">
          {due && <p className={due.late ? "late" : ""}>{due.text}</p>}
          {task.targetAt && <p className="muted">Aim for {fmtMoment(new Date(task.targetAt))}</p>}
        </div>
      )}
    </article>
  );
}
