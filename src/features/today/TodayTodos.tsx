// Today's to-dos: what was picked for today and what is due today, the ones left from an
// earlier day, and the "What do you want to do today?" picker.

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import { useAllSpaces, useTaskAction, useTasks } from "../../lib/queries";
import { useUi } from "../../lib/store";
import { toDateInput } from "../../lib/time";
import { dueSoon, leftOver, todayList } from "../../lib/today";
import { INBOX_ID, type Space, type Task } from "../../lib/types";
import { parseNote } from "../../lib/quickNote";
import { AddTodo, SpaceChip, TodoRow, dueText, isOnToday, useSetToday } from "../tasks/Todo";

export function TodayTodos({ now }: { now: Date }) {
  const tasks = useTasks().data ?? [];
  const spaces = useAllSpaces().data ?? [];
  const act = useTaskAction();
  const spaceById = useMemo(() => new Map(spaces.map((s) => [s.id, s])), [spaces]);
  const list = todayList(tasks, now);
  const done = list.filter((t) => t.completedAt).length;
  const inbox = tasks.filter((t) => t.spaceId === INBOX_ID && !t.completedAt && !list.includes(t)).length;

  const add = (text: string) =>
    act.mutate(async () => {
      const t = await api.addInbox(parseNote(text));
      return api.setTaskToday(t.id, toDateInput(new Date()));
    });

  return (
    <>
      <LeftOver now={now} tasks={tasks} />
      <section className="block todo-block today-todos">
        <div className="block-head">
          <h2>Today</h2>
          {list.length > 0 && <span className="muted small">{done} of {list.length} done</span>}
          <span className="spacer" />
          <button className="btn small" onClick={() => useUi.setState({ pickTodayOpen: true })}>+ From my to-dos</button>
        </div>
        {list.length === 0 ? (
          <p className="muted">Nothing on Today yet. Pick from your to-dos, or write something down.</p>
        ) : (
          <ul className="todo-list">
            {list.map((t) => <TodoRow key={t.id} task={t} space={spaceById.get(t.spaceId)} showSpace todayChip={false} steps />)}
          </ul>
        )}
        <AddTodo placeholder="Write something down for today" onAdd={add} />
        {inbox > 0 && (
          <p className="muted small">
            Inbox: {inbox} not in a space yet ·{" "}
            <button className="link inline-link" onClick={() => useUi.getState().openTasks("inbox")}>Sort them</button>
          </p>
        )}
      </section>
      <TodayPicker now={now} tasks={tasks} spaces={spaces} />
    </>
  );
}

/** To-dos picked for an earlier day and not done: asked about, kept or let go (Settings › Today). */
function LeftOver({ now, tasks }: { now: Date; tasks: Task[] }) {
  const mode = useUi((s) => s.prefs.yesterdayMode);
  const act = useTaskAction();
  const left = leftOver(tasks, now);
  const today = toDateInput(now);
  const handled = useRef(new Set<string>());

  useEffect(() => {
    if (mode === "ask") return;
    for (const t of left) {
      if (handled.current.has(t.id + today)) continue;
      handled.current.add(t.id + today);
      act.mutate(() => api.setTaskToday(t.id, mode === "keep" ? today : null));
    }
  });

  if (mode !== "ask" || left.length === 0) return null;
  const set = (t: Task, keep: boolean) => act.mutate(() => api.setTaskToday(t.id, keep ? today : null));
  const yesterday = toDateInput(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const fromYesterday = left.every((t) => t.todayOn === yesterday);
  return (
    <section className="block leftover" aria-label="Left from an earlier day">
      <div className="block-head">
        <h2>
          {left.length === 1 ? "1 thing" : `${left.length} things`} from {fromYesterday ? "yesterday" : "earlier days"}
        </h2>
        <span className="spacer" />
        {left.length > 1 && (
          <>
            <button className="link" onClick={() => left.forEach((t) => set(t, true))}>Keep all</button>
            <button className="link" onClick={() => left.forEach((t) => set(t, false))}>None today</button>
          </>
        )}
      </div>
      <ul className="leftover-list">
        {left.map((t) => (
          <li key={t.id}>
            <span className="leftover-title">{t.title || "Untitled"}</span>
            <button className="btn small" onClick={() => set(t, true)}>Keep for today</button>
            <button className="btn small quiet" onClick={() => set(t, false)}>Not today</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "What do you want to do today?": every open to-do, grouped, with a button to put it on Today. */
function TodayPicker({ now, tasks, spaces }: { now: Date; tasks: Task[]; spaces: Space[] }) {
  const open = useUi((s) => s.pickTodayOpen);
  const ref = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const setToday = useSetToday();

  useEffect(() => {
    if (open) {
      setQuery("");
      ref.current?.showModal();
    } else ref.current?.close();
  }, [open]);

  const close = () => useUi.setState({ pickTodayOpen: false });
  const spaceById = new Map(spaces.map((s) => [s.id, s]));
  const q = query.trim().toLowerCase();
  const matches = (t: Task) =>
    !q || t.title.toLowerCase().includes(q) || (spaceById.get(t.spaceId)?.name ?? "").toLowerCase().includes(q);
  const openTasks = tasks.filter((t) => !t.completedAt && matches(t));
  const onToday = todayList(tasks, now).filter((t) => !t.completedAt).length;

  // Each to-do shows once: due soon first, then the Inbox, then each course and list.
  const groups: { title: string; items: Task[] }[] = [];
  const seen = new Set<string>();
  const push = (title: string, items: Task[]) => {
    const fresh = items.filter((t) => !seen.has(t.id));
    fresh.forEach((t) => seen.add(t.id));
    if (fresh.length) groups.push({ title, items: fresh });
  };
  push("Due soon", dueSoon(openTasks, now));
  push("Inbox", openTasks.filter((t) => t.spaceId === INBOX_ID));
  for (const s of spaces.filter((s) => !s.deletedAt && (s.kind === "project" || s.kind === "list"))) {
    push(s.name, openTasks.filter((t) => t.spaceId === s.id).sort((a, b) => a.sortOrder - b.sortOrder));
  }

  return (
    <dialog ref={ref} className="dialog picker" onClose={close} aria-labelledby="pick-title">
      <div className="picker-head">
        <div className="block-head">
          <h2 id="pick-title">What do you want to do today?</h2>
          <span className="muted small">{onToday} on Today</span>
        </div>
        <input
          type="search"
          className="search wide"
          placeholder="Search: a word, a course or a list"
          aria-label="Search all to-dos"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="picker-body">
        {groups.length === 0 && <p className="muted">{q ? "Nothing matches." : "No open to-dos. Write something down on Today."}</p>}
        {groups.map((g) => (
          <div key={g.title} className="picker-group">
            <h3>{g.title}</h3>
            <ul>
              {g.items.map((t) => {
                const on = isOnToday(t);
                const due = dueText(t);
                return (
                  <li key={t.id} className="picker-row">
                    <span className="picker-title">{t.title || "Untitled"}</span>
                    {t.parts.length > 0 && <span className="muted small">{t.parts.length} steps</span>}
                    {due && <span className={`chip${due.late ? " late" : ""}`}>{due.text}</span>}
                    {g.title === "Due soon" && <SpaceChip space={spaceById.get(t.spaceId)} spaceId={t.spaceId} />}
                    <button
                      className={`pick-btn${on ? " on" : ""}`}
                      aria-pressed={on}
                      aria-label={on ? `${t.title || "Untitled"} is on Today; take it off` : `Put ${t.title || "Untitled"} on Today`}
                      onClick={() => setToday(t, !on)}
                    >
                      {on ? "✓" : "+"}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <div className="dialog-foot picker-foot">
        <span className="spacer" />
        <button className="btn primary" onClick={close}>Done</button>
      </div>
    </dialog>
  );
}
