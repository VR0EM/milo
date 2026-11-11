import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { colorVar } from "../../lib/colors";
import { useSpaces, useTaskAction, useTaskTypes, useTasks } from "../../lib/queries";
import { useUi } from "../../lib/store";
import { daysFromToday, fmtMoment, fmtRelativeDays } from "../../lib/time";
import { taskProgress, type Space, type Task, type TaskType } from "../../lib/types";
import { ignoreForShortcut } from "../shortcuts/keys";
import { PriorityMark } from "../../components/PriorityMark";
import { TaskPanel } from "./TaskPanel";

type Due = "all" | "overdue" | "week" | "later" | "none";
type Status = "open" | "done" | "all";
type Sort = "deadline" | "title" | "space" | "priority";
const PRIO_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

const DUE: [Due, string][] = [["all", "Any time"], ["overdue", "Overdue"], ["week", "Next 7 days"], ["later", "Later"], ["none", "No deadline"]];
const STATUS: [Status, string][] = [["open", "Open"], ["done", "Done"], ["all", "All"]];

export function deadlineLine(task: Task): { text: string; late: boolean } | null {
  if (!task.deadlineAt) return null;
  const d = new Date(task.deadlineAt);
  const late = !task.completedAt && d.getTime() < Date.now();
  return { text: `Due ${fmtMoment(d)} · ${fmtRelativeDays(daysFromToday(d))}`, late };
}

function dueBucket(t: Task): Exclude<Due, "all"> {
  if (!t.deadlineAt) return "none";
  const d = new Date(t.deadlineAt);
  if (!t.completedAt && d.getTime() < Date.now()) return "overdue";
  return daysFromToday(d) <= 7 ? "week" : "later";
}

/** Filters live for the session, so leaving Tasks and coming back keeps them. */
const filters = { query: "", spaceId: "", due: "all" as Due, status: "open" as Status, sort: "deadline" as Sort };

export function TasksView() {
  const spaces = useSpaces().data ?? [];
  const types = useTaskTypes().data ?? [];
  const tasks = useTasks().data ?? [];
  const lastSpaceId = useUi((s) => s.lastSpaceId);
  const selectedId = useUi((s) => s.selectedTaskId);
  const act = useTaskAction();

  const [query, setQuery] = useState(filters.query);
  const [spaceId, setSpaceId] = useState(filters.spaceId);
  const [due, setDue] = useState<Due>(filters.due);
  const [status, setStatus] = useState<Status>(filters.status);
  const [sort, setSort] = useState<Sort>(filters.sort);
  Object.assign(filters, { query, spaceId, due, status, sort });

  const active = spaces.filter((s) => !s.deletedAt);
  const defaultSpaceId = (active.find((s) => s.id === (spaceId || lastSpaceId)) ?? active[0])?.id ?? null;
  const selected = tasks.find((t) => t.id === selectedId) ?? null;
  const spaceById = useMemo(() => new Map(spaces.map((s) => [s.id, s])), [spaces]);
  const typeById = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = tasks.filter(
      (t) =>
        (status === "all" || (status === "done") === !!t.completedAt) &&
        (!spaceId || t.spaceId === spaceId) &&
        (due === "all" || dueBucket(t) === due) &&
        (!q || t.title.toLowerCase().includes(q) || t.parts.some((p) => p.title.toLowerCase().includes(q))),
    );
    const name = (t: Task) => (t.title || "Untitled").toLowerCase();
    return list.sort((a, b) => {
      if (sort === "title") return name(a).localeCompare(name(b));
      if (sort === "priority") return (PRIO_RANK[a.priority ?? ""] ?? 3) - (PRIO_RANK[b.priority ?? ""] ?? 3) || (a.deadlineAt ?? "9999").localeCompare(b.deadlineAt ?? "9999");
      if (sort === "space") return (spaceById.get(a.spaceId)?.name ?? "").localeCompare(spaceById.get(b.spaceId)?.name ?? "") || name(a).localeCompare(name(b));
      const da = a.deadlineAt ?? "9999";
      const db = b.deadlineAt ?? "9999";
      return da.localeCompare(db) || name(a).localeCompare(name(b));
    });
  }, [tasks, query, spaceId, due, status, sort, spaceById]);

  const openCount = tasks.filter((t) => !t.completedAt).length;
  const filtered = !!query || !!spaceId || due !== "all" || status !== "open";

  const newTask = () => {
    if (!defaultSpaceId) return;
    act.mutate(
      () => api.createTask({ spaceId: defaultSpaceId, typeId: null, title: "", notes: "", deadlineAt: null, targetAt: null, priority: null }),
      { onSuccess: (t) => useUi.getState().selectTask(t.id, true) },
    );
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ignoreForShortcut(e)) return;
      if (e.key === "n") {
        e.preventDefault();
        newTask();
      } else if (e.key === "Escape") useUi.getState().selectTask(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const header = (key: Sort, label: string) => (
    <button className={`th-sort${sort === key ? " on" : ""}`} onClick={() => setSort(key)} aria-pressed={sort === key}>
      {label}
    </button>
  );

  return (
    <>
      <main className="tasks">
        <header className="toolbar">
          <h1>
            Tasks<span className="h1-note">{openCount} open</span>
          </h1>
          <div className="toolbar-actions">
            <input className="search" type="search" placeholder="Search tasks" aria-label="Search tasks" value={query} onChange={(e) => setQuery(e.target.value)} />
            <button className="btn primary" disabled={!defaultSpaceId} onClick={newTask}>New task</button>
          </div>
        </header>

        <div className="filter-bar" role="group" aria-label="Filters">
          <select aria-label="Space" value={spaceId} onChange={(e) => setSpaceId(e.target.value)} className={spaceId ? "set" : ""}>
            <option value="">All spaces</option>
            {active.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <div className="segmented" role="radiogroup" aria-label="Deadline">
            {DUE.map(([k, label]) => (
              <button key={k} role="radio" aria-checked={due === k} className={due === k ? "on" : ""} onClick={() => setDue(k)}>{label}</button>
            ))}
          </div>
          <div className="segmented" role="radiogroup" aria-label="Status">
            {STATUS.map(([k, label]) => (
              <button key={k} role="radio" aria-checked={status === k} className={status === k ? "on" : ""} onClick={() => setStatus(k)}>{label}</button>
            ))}
          </div>
          {filtered && (
            <button className="link" onClick={() => { setQuery(""); setSpaceId(""); setDue("all"); setStatus("open"); }}>Clear filters</button>
          )}
        </div>

        <div className="task-table-wrap" onClick={(e) => e.target === e.currentTarget && useUi.getState().selectTask(null)}>
          <div className="task-table" role="table" aria-label="Tasks">
            <div className="tr th" role="row">
              <span role="columnheader" />
              <span role="columnheader">{header("title", "Task")}</span>
              <span role="columnheader">Progress</span>
              <span role="columnheader">{header("priority", "Priority")}</span>
              <span role="columnheader">{header("space", "Space")}</span>
              <span role="columnheader">Type</span>
              <span role="columnheader">{header("deadline", "Deadline")}</span>
            </div>
            {shown.map((t) => (
              <TaskRow key={t.id} task={t} space={spaceById.get(t.spaceId)} type={t.typeId ? typeById.get(t.typeId) : undefined} selected={t.id === selectedId} />
            ))}
          </div>
          {shown.length === 0 && (
            <div className="table-empty">
              {tasks.length === 0 ? (
                <>No tasks yet. Press <kbd>N</kbd> or use New task.</>
              ) : (
                <>
                  No tasks match these filters.{" "}
                  <button className="link" onClick={() => { setQuery(""); setSpaceId(""); setDue("all"); setStatus("all"); }}>Show all tasks</button>
                </>
              )}
            </div>
          )}
        </div>
      </main>
      {selected && <TaskPanel task={selected} spaces={spaces} types={types} />}
    </>
  );
}

function TaskRow({ task, space, type, selected }: { task: Task; space?: Space; type?: TaskType; selected: boolean }) {
  const act = useTaskAction();
  const done = task.parts.filter((p) => p.doneAt).length;
  const hasParts = task.parts.length > 0;
  const due = task.deadlineAt ? new Date(task.deadlineAt) : null;
  const late = !!due && !task.completedAt && due.getTime() < Date.now();
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  // With parts: ticking finishes the remaining parts. Reopening is done by unticking a part.
  const toggle = (checked: boolean) => {
    if (!hasParts) act.mutate(() => api.setTaskCompleted(task.id, checked));
    else if (checked) {
      act.mutate(async () => {
        let last = task;
        for (const p of task.parts.filter((p) => !p.doneAt)) last = await api.setPartDone(p.id, true);
        return last;
      });
    }
  };

  return (
    <div
      className={`tr${selected ? " selected" : ""}${task.completedAt ? " done" : ""}`}
      role="row"
      tabIndex={0}
      aria-selected={selected}
      onClick={() => useUi.getState().selectTask(task.id)}
      onKeyDown={(e) => e.key === "Enter" && useUi.getState().selectTask(task.id)}
      style={{ ["--c" as string]: colorVar(space?.color ?? "gray") }}
    >
      <span role="cell" onClick={stop}>
        <input
          type="checkbox"
          aria-label={`${task.title || "Untitled"} done`}
          checked={!!task.completedAt}
          disabled={hasParts && !!task.completedAt}
          title={hasParts && task.completedAt ? "Untick a part to reopen this task" : undefined}
          onChange={(e) => toggle(e.target.checked)}
        />
      </span>
      <span role="cell" className="td-title">
        <span className="t-title">{task.title || "Untitled"}</span>
      </span>
      <span role="cell">
        {hasParts ? (
          <span className="t-parts" aria-label={`${done} of ${task.parts.length} parts done`}>
            <span className="mini-progress" aria-hidden="true"><span style={{ width: `${taskProgress(task) * 100}%` }} /></span>
            <span aria-hidden="true">{done}/{task.parts.length}</span>
          </span>
        ) : (
          <span className="muted">—</span>
        )}
      </span>
      <span role="cell" className="td-prio"><PriorityMark priority={task.priority} /></span>
      <span role="cell"><span className="space-pill"><i />{space?.name ?? "—"}</span></span>
      <span role="cell" className="muted">{type?.name ?? "—"}</span>
      <span role="cell" className={late ? "late" : due ? "" : "muted"}>
        {due ? (
          <>
            {fmtMoment(due).replace(/^\w+ /, "")}
            <span className="t-rel">{fmtRelativeDays(daysFromToday(due))}</span>
          </>
        ) : "—"}
      </span>
    </div>
  );
}
