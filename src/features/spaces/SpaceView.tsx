import { useMemo, useState } from "react";
import { api } from "../../lib/api";
import { colorVar } from "../../lib/colors";
import { spaceProgress } from "../../lib/spaces";
import { useAction, useActivities, useEvents, useGroups, useInsights, useSections, useSpaces, useTaskAction, useTaskTypes, useTasks } from "../../lib/queries";
import { useUi } from "../../lib/store";
import { addDays, daysFromToday, fmtDuration, fmtRange, fmtRelativeDays, startOfDay, startOfWeek, toDateInput } from "../../lib/time";
import type { CalEvent, Insights, Section, Space, Task, TaskType } from "../../lib/types";
import { useNow } from "../../lib/useNow";
import { Icon, SpaceMark } from "../../components/Icon";
import { openContextMenu, type MenuItem } from "../../components/ContextMenu";
import { fmtMinutes } from "../insights/Charts";
import { TaskPanel } from "../tasks/TaskPanel";
import { AddTodo, TodoRow } from "../tasks/Todo";

const AHEAD_DAYS = 14;
const BACK_DAYS = 30;
const LIST_MAX = 8;
const KIND_NAME = { project: "Project", list: "List", none: "Time only", inbox: "Inbox" } as const;

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

const blank = (space: Space, title: string, sectionId: string | null = null) => ({
  spaceId: space.id, typeId: null, title, notes: "", deadlineAt: null, targetAt: null, priority: null, sectionId,
});

/** One space: a course with its parts, a list to tick off, or (time only) its hours and events. */
export function SpaceView() {
  const spaceId = useUi((s) => s.spaceViewId);
  const spaces = useSpaces().data ?? [];
  const groups = useGroups().data ?? [];
  const types = useTaskTypes().data ?? [];
  const allTasks = useTasks().data ?? [];
  const selectedTaskId = useUi((s) => s.selectedTaskId);
  const now = useNow(60_000);
  const today = startOfDay(now);
  const weekFrom = startOfWeek(today);
  const week = useInsights(toDateInput(weekFrom), toDateInput(addDays(weekFrom, 7))).data;

  const space = spaces.find((s) => s.id === spaceId);
  const tasks = useMemo(() => allTasks.filter((t) => t.spaceId === spaceId), [allTasks, spaceId]);
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

  const group = groups.find((g) => g.id === space.groupId);
  const p = spaceProgress(tasks);
  const hours = spaceTime(week, space.id).total;
  const note = [
    KIND_NAME[space.kind],
    group?.name,
    space.kind === "project" && p.total ? `${p.done} of ${p.total} done` : null,
    space.kind === "list" ? `${p.total - p.done} to do` : null,
    hours ? `${fmtMinutes(hours)} this week` : null,
  ].filter(Boolean).join(" · ");

  return (
    <>
      <main className={`page space-page${selectedTask ? "" : " full"}`} style={{ ["--c" as string]: colorVar(space.color) }}>
        <header className="toolbar">
          <h1>
            <SpaceMark icon={space.icon} size={18} />
            {space.name}
            <span className="h1-note">{note}</span>
          </h1>
          <div className="toolbar-actions">
            <button className="btn" onClick={() => useUi.getState().openDialog({ kind: "space", item: space })}>Edit</button>
          </div>
        </header>

        <div className="page-scroll">
          {space.kind === "project" && <ProjectBody space={space} tasks={tasks} types={types} />}
          {space.kind === "list" && <ListBody space={space} tasks={tasks} types={types} />}
          <TimeBody space={space} now={now} full={space.kind === "none"} />
        </div>
      </main>
      {selectedTask && <TaskPanel task={selectedTask} spaces={spaces} types={types} />}
    </>
  );
}

// ---------- a course ----------

/** Parts folded shut, remembered for the session. Finished parts start folded. */
const folded = new Map<string, boolean>();

function ProjectBody({ space, tasks, types }: { space: Space; tasks: Task[]; types: TaskType[] }) {
  const sections = (useSections().data ?? []).filter((x) => x.spaceId === space.id);
  const act = useAction("sections");
  const [adding, setAdding] = useState(false);
  const typeById = new Map(types.map((t) => [t.id, t]));
  const p = spaceProgress(tasks);
  const pct = Math.round(p.share * 100);
  const mineTypes = types.filter((ty) => !ty.deletedAt && (ty.spaceId === space.id || tasks.some((t) => t.typeId === ty.id)));
  const known = new Set(sections.map((x) => x.id));
  const loose = tasks.filter((t) => !t.sectionId || !known.has(t.sectionId));

  return (
    <>
      <section className="block progress-card" aria-label="Progress">
        <div className="progress-cell">
          <span className="muted small strong">Progress</span>
          <span className="progress-big tabular">{pct}%</span>
          <span className="progress"><div style={{ width: `${pct}%` }} /></span>
        </div>
        {mineTypes.map((ty) => {
          const mine = tasks.filter((t) => t.typeId === ty.id);
          const done = mine.filter((t) => t.completedAt).length;
          return (
            <div key={ty.id} className="progress-cell">
              <span className="muted small strong">{ty.name}</span>
              <span className="progress-mid tabular">{done}/{mine.length}</span>
              <span className="progress neutral-c"><div style={{ width: `${mine.length ? (done / mine.length) * 100 : 0}%` }} /></span>
            </div>
          );
        })}
      </section>

      <section className="overview-group" aria-labelledby="parts-h">
        <div className="block-head">
          <h2 id="parts-h">{sections.length ? "Parts" : "To-dos"}</h2>
          <span className="spacer" />
          <button className="btn small" onClick={() => setAdding(true)}>New part</button>
        </div>
        {adding && (
          <form
            className="section-new"
            onSubmit={(e) => {
              e.preventDefault();
              const name = String(new FormData(e.currentTarget).get("name") ?? "").trim();
              if (name) act.mutate(() => api.createSection(space.id, name));
              setAdding(false);
            }}
          >
            <input name="name" autoFocus placeholder="Name of the part, e.g. 02 Titration" aria-label="Name of the new part" onBlur={(e) => e.currentTarget.form?.requestSubmit()} onKeyDown={(e) => e.key === "Escape" && setAdding(false)} />
          </form>
        )}
        {sections.map((x, i) => (
          <SectionCard
            key={x.id}
            space={space}
            section={x}
            tasks={tasks.filter((t) => t.sectionId === x.id)}
            typeById={typeById}
            neighbours={[sections[i - 1]?.id, sections[i + 1]?.id]}
            order={sections.map((y) => y.id)}
          />
        ))}
        {(loose.length > 0 || sections.length === 0) && (
          <TodoGroup space={space} title={sections.length ? "Not in a part" : null} tasks={loose} typeById={typeById} sectionId={null} />
        )}
      </section>
    </>
  );
}

function SectionCard({ space, section, tasks, typeById, neighbours, order }: {
  space: Space; section: Section; tasks: Task[]; typeById: Map<string, TaskType>; neighbours: [string?, string?]; order: string[];
}) {
  const act = useAction("sections", "tasks");
  const [, tick] = useState(0);
  const [renaming, setRenaming] = useState(false);
  const done = tasks.filter((t) => t.completedAt).length;
  const allDone = tasks.length > 0 && done === tasks.length;
  const isFolded = folded.get(section.id) ?? allDone;
  const toggle = () => {
    folded.set(section.id, !isFolded);
    tick((n) => n + 1);
  };
  const move = (to: number) => {
    const ids = order.filter((id) => id !== section.id);
    ids.splice(to, 0, section.id);
    act.mutate(() => api.reorderSections(ids));
  };
  const at = order.indexOf(section.id);
  const menu: MenuItem[] = [
    { label: "Rename", run: () => setRenaming(true) },
    { label: "Move up", run: () => move(at - 1), disabled: !neighbours[0] },
    { label: "Move down", run: () => move(at + 1), disabled: !neighbours[1] },
    "separator",
    {
      label: "Archive this part",
      run: () => {
        act.mutate(() => api.setArchived("section", section.id, true));
        useUi.getState().notify({
          text: `${section.name} archived; its to-dos stay in ${space.name}`,
          undo: () => act.mutate(() => api.setArchived("section", section.id, false)),
        });
      },
    },
  ];

  return (
    <div className={`section-card${isFolded ? " folded" : ""}`} onContextMenu={(e) => openContextMenu(e, menu)}>
      <div className="section-head">
        {renaming ? (
          <form
            className="section-rename"
            onSubmit={(e) => {
              e.preventDefault();
              const name = String(new FormData(e.currentTarget).get("name") ?? "").trim();
              if (name && name !== section.name) act.mutate(() => api.updateSection(section.id, name));
              setRenaming(false);
            }}
          >
            <input name="name" defaultValue={section.name} autoFocus aria-label="Name of the part" onBlur={(e) => e.currentTarget.form?.requestSubmit()} onKeyDown={(e) => e.key === "Escape" && setRenaming(false)} />
          </form>
        ) : (
          <button className="section-toggle" aria-expanded={!isFolded} onClick={toggle}>
            <Icon name="chevron" size={11} />
            <span className="section-name">{section.name}</span>
          </button>
        )}
        <span className={`chip${allDone ? " good" : ""}`}>{done}/{tasks.length}</span>
        <button className="icon-btn" aria-label={`Options for ${section.name}`} title="Options" onClick={(e) => openContextMenu(e, menu)}>
          <span aria-hidden="true">⋯</span>
        </button>
      </div>
      {!isFolded && <TodoGroup space={space} title={null} tasks={tasks} typeById={typeById} sectionId={section.id} />}
    </div>
  );
}

/** To-dos of a course or a part of it: open first, then the ones done. */
function TodoGroup({ space, title, tasks, typeById, sectionId }: {
  space: Space; title: string | null; tasks: Task[]; typeById: Map<string, TaskType>; sectionId: string | null;
}) {
  const act = useTaskAction();
  const sorted = [...tasks].sort(
    (a, b) => Number(!!a.completedAt) - Number(!!b.completedAt) || (a.deadlineAt ?? "9999").localeCompare(b.deadlineAt ?? "9999") || a.sortOrder - b.sortOrder,
  );
  const body = (
    <>
      {sorted.length > 0 && (
        <ul className="todo-list">
          {sorted.map((t) => <TodoRow key={t.id} task={t} type={t.typeId ? typeById.get(t.typeId) : undefined} steps />)}
        </ul>
      )}
      <AddTodo placeholder="Add a to-do" onAdd={(title) => act.mutate(() => api.createTask(blank(space, title, sectionId)))} />
    </>
  );
  if (title === null) return <div className="section-body">{body}</div>;
  return (
    <div className="section-card">
      <div className="section-head"><span className="section-name muted">{title}</span></div>
      <div className="section-body">{body}</div>
    </div>
  );
}

// ---------- a list ----------

function ListBody({ space, tasks, types }: { space: Space; tasks: Task[]; types: TaskType[] }) {
  const act = useTaskAction();
  const [showDone, setShowDone] = useState(false);
  const typeById = new Map(types.map((t) => [t.id, t]));
  const open = tasks.filter((t) => !t.completedAt).sort((a, b) => a.sortOrder - b.sortOrder);
  const done = tasks.filter((t) => t.completedAt).sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
  return (
    <section className="block todo-block">
      {open.length === 0 && <p className="muted">Nothing to do here. Add something below.</p>}
      {open.length > 0 && (
        <ul className="todo-list">
          {open.map((t) => <TodoRow key={t.id} task={t} type={t.typeId ? typeById.get(t.typeId) : undefined} steps />)}
        </ul>
      )}
      <AddTodo placeholder="New to-do" onAdd={(title) => act.mutate(() => api.createTask(blank(space, title)))} />
      {done.length > 0 && (
        <button className="link" onClick={() => setShowDone(!showDone)}>
          {showDone ? "Hide done" : `Show done (${done.length})`}
        </button>
      )}
      {showDone && (
        <ul className="todo-list">
          {done.map((t) => <TodoRow key={t.id} task={t} todayChip={false} />)}
        </ul>
      )}
    </section>
  );
}

// ---------- time ----------

/** Time in this space: hours this week and month, what is coming and what happened lately. */
function TimeBody({ space, now, full }: { space: Space; now: Date; full: boolean }) {
  const activities = useActivities().data ?? [];
  const today = startOfDay(now);
  const weekFrom = startOfWeek(today);
  const monthFrom = new Date(today.getFullYear(), today.getMonth(), 1);
  const week = useInsights(toDateInput(weekFrom), toDateInput(addDays(weekFrom, 7))).data;
  const monthData = useInsights(toDateInput(monthFrom), toDateInput(new Date(today.getFullYear(), today.getMonth() + 1, 1))).data;
  const events = useEvents(addDays(today, -BACK_DAYS), addDays(today, AHEAD_DAYS + 1)).data ?? [];
  const activityById = useMemo(() => new Map(activities.map((a) => [a.id, a])), [activities]);
  const mine = useMemo(() => events.filter((e) => e.spaceId === space.id), [events, space.id]);
  const coming = mine.filter((e) => new Date(e.endAt) > now && e.status !== "skipped").sort((a, b) => a.startAt.localeCompare(b.startAt));
  const recent = mine.filter((e) => new Date(e.endAt) <= now).sort((a, b) => b.startAt.localeCompare(a.startAt)).slice(0, LIST_MAX);
  const thisWeek = spaceTime(week, space.id);
  const thisMonth = spaceTime(monthData, space.id);

  // A course or list without any time in the calendar keeps its page to the to-dos.
  if (!full && coming.length === 0 && recent.length === 0) return null;

  const openEvent = (e: CalEvent) => {
    const ui = useUi.getState();
    ui.setView("calendar");
    ui.setCalMode("day");
    ui.showDate(new Date(e.startAt));
    ui.select(e.id);
  };
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
      {full && (
        <div className="stats two">
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
        </div>
      )}
      <section className="block">
        <div className="block-head">
          <h2>Coming up</h2>
          <span className="muted small">next {AHEAD_DAYS} days</span>
        </div>
        {coming.length === 0 ? <p className="muted">Nothing planned.</p> : <ul className="space-list">{coming.slice(0, LIST_MAX).map((e) => eventRow(e, false))}</ul>}
        {coming.length > LIST_MAX && <p className="muted small">{coming.length - LIST_MAX} more in the calendar.</p>}
      </section>
      {(full || recent.length > 0) && (
        <section className="block">
          <div className="block-head">
            <h2>Recently</h2>
            <span className="muted small">last {BACK_DAYS} days</span>
          </div>
          {recent.length === 0 ? <p className="muted">Nothing in the last {BACK_DAYS} days.</p> : <ul className="space-list">{recent.map((e) => eventRow(e, true))}</ul>}
        </section>
      )}
    </>
  );
}
