// One to-do as a row, the same everywhere: on Today, in a list, in a part of a course and in
// the smart lists of Tasks. Click the title for the details beside it.

import { useState } from "react";
import { api } from "../../lib/api";
import { colorVar } from "../../lib/colors";
import { useTaskAction } from "../../lib/queries";
import { useUi } from "../../lib/store";
import { daysFromToday, fmtMoment, fmtTime, toDateInput } from "../../lib/time";
import { INBOX_ID, type Space, type Task, type TaskType } from "../../lib/types";
import { Icon } from "../../components/Icon";

/** Ticking a to-do with steps finishes the steps that are left; unticking a step reopens it. */
export function useToggleTodo() {
  const act = useTaskAction();
  return (task: Task, checked: boolean) => {
    if (!task.parts.length) act.mutate(() => api.setTaskCompleted(task.id, checked));
    else if (checked)
      act.mutate(async () => {
        let last = task;
        for (const p of task.parts.filter((p) => !p.doneAt)) last = await api.setPartDone(p.id, true);
        return last;
      });
  };
}

/** Put a to-do on Today, or take it off. */
export function useSetToday() {
  const act = useTaskAction();
  return (task: Task, on: boolean) => act.mutate(() => api.setTaskToday(task.id, on ? toDateInput(new Date()) : null));
}

export const isOnToday = (t: Task) => t.todayOn === toDateInput(new Date());

/** "2 days late", "today 17:00", "Fri 20 Nov", or null without a deadline. */
export function dueText(t: Task): { text: string; late: boolean } | null {
  if (!t.deadlineAt) return null;
  const d = new Date(t.deadlineAt);
  const n = daysFromToday(d);
  const endOfDay = d.getHours() === 23 && d.getMinutes() === 59;
  if (!t.completedAt && d.getTime() < Date.now()) {
    return { text: n === 0 ? `late since ${fmtTime(d)}` : `${-n} day${n === -1 ? "" : "s"} late`, late: true };
  }
  if (n === 0) return { text: endOfDay ? "today" : `today ${fmtTime(d)}`, late: false };
  if (n === 1) return { text: endOfDay ? "tomorrow" : `tomorrow ${fmtTime(d)}`, late: false };
  return { text: fmtMoment(d), late: false };
}

export function SpaceChip({ space, spaceId }: { space?: Space; spaceId: string }) {
  if (spaceId === INBOX_ID) return <span className="chip">Inbox</span>;
  if (!space) return null;
  return (
    <span className="chip" style={{ ["--c" as string]: colorVar(space.color) }}>
      <i className="chip-dot" />
      {space.name}
    </span>
  );
}

export function TodoCheck({ task }: { task: Task }) {
  const toggle = useToggleTodo();
  const locked = task.parts.length > 0 && !!task.completedAt;
  return (
    <input
      type="checkbox"
      className="todo-check"
      aria-label={`${task.title || "Untitled"} done`}
      checked={!!task.completedAt}
      disabled={locked}
      title={locked ? "Untick a step to reopen it" : undefined}
      onChange={(e) => toggle(task, e.target.checked)}
    />
  );
}

/** Steps unfolded under a to-do are remembered for the session. */
const unfolded = new Set<string>();

interface RowProps {
  task: Task;
  space?: Space;
  type?: TaskType;
  /** Show which space it is in (on Today and in smart lists). */
  showSpace?: boolean;
  /** The "Today" chip to put it on Today or take it off. */
  todayChip?: boolean;
  /** Steps under it, to tick off right here. */
  steps?: boolean;
}

export function TodoRow({ task, space, type, showSpace, todayChip = true, steps }: RowProps) {
  const selectedId = useUi((s) => s.selectedTaskId);
  const setToday = useSetToday();
  const [, tick] = useState(0);
  const due = dueText(task);
  const onToday = isOnToday(task);
  const done = task.parts.filter((p) => p.doneAt).length;
  const open = steps && task.parts.length > 0 && unfolded.has(task.id);
  const fold = () => {
    if (unfolded.has(task.id)) unfolded.delete(task.id);
    else unfolded.add(task.id);
    tick((n) => n + 1);
  };

  return (
    <li className={`todo${task.completedAt ? " done" : ""}${task.id === selectedId ? " selected" : ""}`}>
      <div className="todo-line">
        <TodoCheck task={task} />
        <button className="todo-title" onClick={() => useUi.getState().selectTask(task.id)}>
          {task.title || "Untitled"}
        </button>
        {steps && task.parts.length > 0 && (
          <button className={`todo-fold${open ? " open" : ""}`} aria-expanded={open} onClick={fold} title={open ? "Hide steps" : "Show steps"}>
            <span className="muted small tabular">{done}/{task.parts.length}</span>
            <Icon name="chevron" size={11} />
          </button>
        )}
        {!steps && task.parts.length > 0 && <span className="muted small tabular">{done}/{task.parts.length}</span>}
        {type && <span className="chip">{type.name}</span>}
        {due && <span className={`chip${due.late ? " late" : ""}`}>{due.text}</span>}
        {showSpace && <SpaceChip space={space} spaceId={task.spaceId} />}
        {todayChip && !task.completedAt && (
          <button
            className={`chip today-chip${onToday ? " on" : ""}`}
            aria-pressed={onToday}
            title={onToday ? "Take it off Today" : "Put it on Today"}
            onClick={() => setToday(task, !onToday)}
          >
            {onToday ? "Today" : "+ Today"}
          </button>
        )}
      </div>
      {open && <Steps task={task} />}
    </li>
  );
}

/** The steps of a to-do, ticked off in place, with a field for one more. */
export function Steps({ task }: { task: Task }) {
  const act = useTaskAction();
  const [text, setText] = useState("");
  const add = () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    act.mutate(() => api.createTaskPart(task.id, t));
  };
  return (
    <ul className="todo-steps">
      {task.parts.map((p) => (
        <li key={p.id}>
          <label className={`check step${p.doneAt ? " done" : ""}`}>
            <input
              type="checkbox"
              className="todo-check small"
              checked={!!p.doneAt}
              onChange={(e) => {
                const done = e.target.checked;
                act.mutate(() => api.setPartDone(p.id, done));
              }}
            />
            <span>{p.title}</span>
          </label>
        </li>
      ))}
      <li>
        <input
          className="todo-add-step"
          placeholder="Add a step"
          aria-label={`Add a step to ${task.title || "this to-do"}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
            if (e.key === "Escape") setText("");
          }}
        />
      </li>
    </ul>
  );
}

/** A field that adds a to-do on Enter. */
export function AddTodo({ placeholder, onAdd }: { placeholder: string; onAdd: (title: string) => void }) {
  const [text, setText] = useState("");
  return (
    <form
      className="todo-add"
      onSubmit={(e) => {
        e.preventDefault();
        const t = text.trim();
        if (!t) return;
        setText("");
        onAdd(t);
      }}
    >
      <Icon name="plus" size={12} />
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </form>
  );
}
