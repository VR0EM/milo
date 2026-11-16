// Tasks: an overview first (Today, Upcoming, Inbox, Past the deadline, the courses and the
// lists), and from there one list at a time. The full table is "All to-dos".

import { useEffect, useMemo } from "react";
import { api } from "../../lib/api";
import { colorVar } from "../../lib/colors";
import { spaceProgress } from "../../lib/spaces";
import { useAction, useAllSpaces, useArchiveWithUndo, useRoutines, useSimilar, useSpaceSuggestions, useTaskAction, useTaskTypes, useTasks } from "../../lib/queries";
import { preferredSpace, useUi, type TasksList } from "../../lib/store";
import { fmtHm, toDateInput } from "../../lib/time";
import { pastDeadline, todayList, upcoming } from "../../lib/today";
import { INBOX_ID, type Routine, type Space, type Task, type TaskType } from "../../lib/types";
import { useNow } from "../../lib/useNow";
import { SpaceMark } from "../../components/Icon";
import { ignoreForShortcut } from "../shortcuts/keys";
import { AllTodos } from "./TasksView";
import { looksLikeAppointment, parseNote } from "../../lib/quickNote";
import { pickDefaultSpace } from "../../lib/spaces";
import { TaskPanel } from "./TaskPanel";
import { AddTodo, TodoRow, dueText } from "./Todo";

const TITLES: Record<Exclude<TasksList, "overview" | "all">, string> = {
  today: "Today",
  upcoming: "Upcoming",
  inbox: "Inbox",
  late: "Past the deadline",
};

export function TasksView() {
  const list = useUi((s) => s.tasksList);
  return list === "all" ? <AllTodos /> : <TasksHome list={list} />;
}

const blank = (spaceId: string, title = "") => ({
  spaceId, typeId: null, title, notes: "", deadlineAt: null, targetAt: null, priority: null, sectionId: null,
});

function TasksHome({ list }: { list: Exclude<TasksList, "all"> }) {
  const now = useNow(60_000);
  const spaces = useAllSpaces().data ?? [];
  const types = useTaskTypes().data ?? [];
  const tasks = useTasks().data ?? [];
  const selectedId = useUi((s) => s.selectedTaskId);
  const act = useTaskAction();
  const selected = tasks.find((t) => t.id === selectedId) ?? null;

  /** A new to-do goes to the Inbox (a typed note with its day and steps read from it); made
   * from the Today list it is also on Today. */
  const add = (title = "", focus = true) =>
    act.mutate(
      async () => {
        const t = title ? await api.addInbox(parseNote(title)) : await api.createTask(blank(INBOX_ID, title));
        return list === "today" ? api.setTaskToday(t.id, toDateInput(new Date())) : t;
      },
      { onSuccess: (t) => focus && useUi.getState().selectTask(t.id, true) },
    );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ignoreForShortcut(e)) return;
      if (e.key === "n") {
        e.preventDefault();
        add();
      } else if (e.key === "Escape") useUi.getState().selectTask(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const open = tasks.filter((t) => !t.completedAt);
  return (
    <>
      <main className={`page tasks-home${selected ? "" : " full"}`}>
        <header className="toolbar">
          {list === "overview" ? (
            <h1>
              Tasks<span className="h1-note">{open.length} to do</span>
            </h1>
          ) : (
            <h1>
              <button className="crumb" onClick={() => useUi.getState().openTasks("overview")}>Tasks</button>
              <span className="crumb-sep" aria-hidden="true">›</span>
              {TITLES[list]}
            </h1>
          )}
          <div className="toolbar-actions">
            <button className="btn" onClick={() => useUi.getState().openTasks("all")}>All to-dos</button>
            <button className="btn primary" onClick={() => add()}>New to-do</button>
          </div>
        </header>
        <div className="page-scroll">
          {list === "overview" ? (
            <Overview now={now} tasks={tasks} spaces={spaces} types={types} />
          ) : (
            <SmartList list={list} now={now} tasks={tasks} spaces={spaces} types={types} onAdd={(t) => add(t, false)} />
          )}
        </div>
      </main>
      {selected && <TaskPanel task={selected} spaces={spaces} types={types} />}
    </>
  );
}

function Overview({ now, tasks, spaces, types }: { now: Date; tasks: Task[]; spaces: Space[]; types: TaskType[] }) {
  const routines = useRoutines().data ?? [];
  const today = todayList(tasks, now);
  const late = pastDeadline(tasks, now);
  const soon = upcoming(tasks, now);
  const inbox = tasks.filter((t) => t.spaceId === INBOX_ID && !t.completedAt);
  const courses = spaces.filter((s) => !s.deletedAt && s.kind === "project");
  const lists = spaces.filter((s) => !s.deletedAt && s.kind === "list");
  const go = (l: TasksList) => useUi.getState().openTasks(l);
  const todayDone = today.filter((t) => t.completedAt).length;

  return (
    <>
      <section className="tiles" aria-label="At a glance">
        <button className="tile" onClick={() => go("today")}>
          <span className="tile-label">Today</span>
          <span className="tile-value">{today.length - todayDone}</span>
          <span className="tile-note">{todayDone ? `${todayDone} done` : today.length ? "to do" : "nothing picked yet"}</span>
        </button>
        <button className="tile" onClick={() => go("upcoming")}>
          <span className="tile-label">Upcoming</span>
          <span className="tile-value">{soon.length}</span>
          <span className="tile-note">next 7 days</span>
        </button>
        <button className="tile" onClick={() => go("inbox")}>
          <span className="tile-label">Inbox</span>
          <span className="tile-value">{inbox.length}</span>
          <span className="tile-note">not in a space yet</span>
        </button>
        <button className={`tile${late.length ? " warn" : ""}`} onClick={() => go("late")}>
          <span className="tile-label">Past the deadline</span>
          <span className="tile-value">{late.length}</span>
          <span className="tile-note ellipsis">{late.length ? late[0].title || "Untitled" : "nothing late"}</span>
        </button>
      </section>

      <section className="overview-group" aria-labelledby="courses-h">
        <div className="block-head">
          <h2 id="courses-h">Courses</h2>
          <span className="spacer" />
          <button className="link" onClick={() => useUi.getState().openDialog({ kind: "space", spaceKind: "project" })}>New course</button>
        </div>
        {courses.length === 0 ? (
          <p className="muted">No courses yet. A course is a space of the kind Project: its to-dos sit in parts, with types and progress.</p>
        ) : (
          <div className="course-grid">
            {courses.map((c) => <CourseCard key={c.id} space={c} tasks={tasks.filter((t) => t.spaceId === c.id)} types={types} />)}
          </div>
        )}
      </section>

      <section className="overview-group" aria-labelledby="lists-h">
        <div className="block-head">
          <h2 id="lists-h">Lists</h2>
          <span className="spacer" />
          <button className="link" onClick={() => useUi.getState().openDialog({ kind: "space", spaceKind: "list" })}>New list</button>
          <NewRoutine />
        </div>
        <div className="list-grid">
          {lists.map((l) => {
            const mine = tasks.filter((t) => t.spaceId === l.id && !t.completedAt);
            const forToday = mine.filter((t) => today.includes(t)).length;
            return (
              <button key={l.id} className="list-card" style={{ ["--c" as string]: colorVar(l.color) }} onClick={() => useUi.getState().openSpace(l.id)}>
                <span className="list-card-name"><SpaceMark icon={l.icon} />{l.name}</span>
                <span className="muted small">{mine.length} to do{forToday ? ` · ${forToday} for today` : ""}</span>
              </button>
            );
          })}
          {routines.map((r) => <RoutineCard key={r.id} routine={r} />)}
        </div>
      </section>
    </>
  );
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** "every day", "Mon–Fri", or "Mon, Wed, Fri". */
export function fmtDays(weekdays: string) {
  if (weekdays.length === 7) return "every day";
  if (weekdays === "12345") return "Mon–Fri";
  if (weekdays === "67") return "weekends";
  return weekdays.split("").map((d) => DAY_NAMES[Number(d) - 1]).join(", ");
}

function RoutineCard({ routine }: { routine: Routine }) {
  const space = useAllSpaces().data?.find((s) => s.id === routine.spaceId);
  return (
    <button className="list-card routine-card" onClick={() => useUi.setState({ routineEditId: routine.id })}>
      <span className="list-card-name">{routine.name}</span>
      <span className="muted small">
        {space ? `Routine · during ${space.name} events` : `Routine · ${fmtHm(routine.startTime)}–${fmtHm(routine.endTime)} · ${fmtDays(routine.weekdays)}`}
      </span>
    </button>
  );
}

function NewRoutine() {
  const act = useAction("routines");
  return (
    <button
      className="link"
      onClick={() =>
        act.mutate(async () => {
          const r = await api.createRoutine({ name: "New routine", startTime: "07:00", endTime: "09:00", weekdays: "1234567" });
          useUi.setState({ routineEditId: r.id });
        })
      }
    >
      New routine
    </button>
  );
}

function CourseCard({ space, tasks, types }: { space: Space; tasks: Task[]; types: TaskType[] }) {
  const p = spaceProgress(tasks);
  const pct = Math.round(p.share * 100);
  const byType = types
    .map((ty) => {
      const mine = tasks.filter((t) => t.typeId === ty.id);
      return { name: ty.name, done: mine.filter((t) => t.completedAt).length, total: mine.length };
    })
    .filter((x) => x.total > 0);
  const next = tasks
    .filter((t) => !t.completedAt && t.deadlineAt)
    .sort((a, b) => a.deadlineAt!.localeCompare(b.deadlineAt!))[0];
  const due = next ? dueText(next) : null;
  return (
    <button className="course-card" style={{ ["--c" as string]: colorVar(space.color) }} onClick={() => useUi.getState().openSpace(space.id)}>
      <span className="course-head">
        <span className="course-mark"><SpaceMark icon={space.icon} size={16} /></span>
        <span className="course-name">
          <span>{space.name}</span>
          <span className="muted small">{p.total - p.done} to do · {p.done} done</span>
        </span>
        <span className="course-pct tabular">{pct}%</span>
      </span>
      <span className="progress" aria-label={`${pct}% done`}><div style={{ width: `${pct}%` }} /></span>
      {byType.length > 0 && (
        <span className="course-types muted small">
          {byType.map((x) => <span key={x.name}>{x.name} {x.done}/{x.total}</span>)}
        </span>
      )}
      <span className="course-next small">
        <span className="ellipsis">{next ? next.title || "Untitled" : "No deadline coming"}</span>
        {due && <span className={due.late ? "late" : "muted"}>{due.text}</span>}
      </span>
    </button>
  );
}

function SmartList({ list, now, tasks, spaces, types, onAdd }: {
  list: Exclude<TasksList, "overview" | "all">; now: Date; tasks: Task[]; spaces: Space[]; types: TaskType[]; onAdd: (title: string) => void;
}) {
  const spaceById = useMemo(() => new Map(spaces.map((s) => [s.id, s])), [spaces]);
  const typeById = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);
  const shown =
    list === "today" ? todayList(tasks, now)
    : list === "upcoming" ? upcoming(tasks, now)
    : list === "late" ? pastDeadline(tasks, now)
    : tasks.filter((t) => t.spaceId === INBOX_ID && !t.completedAt);
  const suggestions = useSpaceSuggestions(list === "inbox" ? shown : []).data;
  const appointments = list === "inbox" ? shown.filter(looksLikeAppointment) : [];
  const repeats = useSimilar(list === "inbox" ? shown : []).data;
  const archive = useArchiveWithUndo();
  const eventSpaces = useSpaceSuggestions(appointments, true).data;
  const fallback = pickDefaultSpace(spaces.filter((s) => s.kind !== "inbox"), useUi(preferredSpace))?.id ?? null;
  const empty = {
    today: "Nothing on Today yet. Put a to-do here with + Today, or add one below.",
    upcoming: "No deadlines in the next 7 days.",
    late: "Nothing is past its deadline.",
    inbox: "The Inbox is empty. Notes you write down land here until they get a space.",
  }[list];

  return (
    <section className="block todo-block">
      {shown.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <ul className="todo-list">
          {shown.map((t) => (
            <TodoRow
              key={t.id}
              task={t}
              space={spaceById.get(t.spaceId)}
              type={t.typeId ? typeById.get(t.typeId) : undefined}
              showSpace={list !== "inbox"}
              suggestion={suggestions?.get(t.id)}
              eventSpaceId={(eventSpaces?.get(t.id)?.sure && eventSpaces.get(t.id)!.choices[0]?.spaceId) || fallback}
              below={repeats?.get(t.id) && (
                <p className="todo-repeat small">
                  <span className="muted">Already there: </span>
                  <button className="link inline-link" onClick={() => useUi.getState().selectTask(repeats.get(t.id)!.taskId)}>
                    {repeats.get(t.id)!.title}
                  </button>
                  <span className="muted"> · {spaceById.get(repeats.get(t.id)!.spaceId)?.name ?? "Inbox"} · </span>
                  <button className="link inline-link" onClick={() => archive("task", t.id, t.title || "Note")}>Remove this note</button>
                </p>
              )}
              spaceById={spaceById}
              todayChip={list !== "today"}
              steps
            />
          ))}
        </ul>
      )}
      {(list === "today" || list === "inbox") && (
        <AddTodo placeholder={list === "today" ? "Add a to-do for today" : "Write something down"} onAdd={onAdd} />
      )}
    </section>
  );
}

