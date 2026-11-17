// One to-do as a row, the same everywhere: on Today, in a list, in a part of a course and in
// the smart lists of Tasks. Click the title for the details beside it.

import { useState } from "react";
import { api } from "../../lib/api";
import { colorVar } from "../../lib/colors";
import { useAction, useTaskAction, useUpdateTask } from "../../lib/queries";
import { looksLikeAppointment } from "../../lib/quickNote";
import { useUi } from "../../lib/store";
import { daysFromToday, fmtMoment, fmtTime, toDateInput } from "../../lib/time";
import { INBOX_ID, type Space, type SpaceSuggestion, type Task, type TaskType } from "../../lib/types";
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
  /** For a note in the Inbox: the courses or lists it may belong to, one click each. */
  suggestion?: SpaceSuggestion;
  spaceById?: Map<string, Space>;
  /** For a note that reads like an appointment: the space an event for it would go to. */
  eventSpaceId?: string | null;
  /** Anything else under the row, such as choices for a part. */
  below?: React.ReactNode;
}

export function TodoRow({ task, space, type, showSpace, todayChip = true, steps, suggestion, spaceById, eventSpaceId, below }: RowProps) {
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
      {eventSpaceId && spaceById && looksLikeAppointment(task) && (
        <CalendarOffer task={task} space={spaceById.get(eventSpaceId)} />
      )}
      {suggestion && spaceById && suggestion.choices.length > 0 && (
        <MoveChoices task={task} suggestion={suggestion} spaceById={spaceById} />
      )}
      {below}
      {open && <Steps task={task} />}
    </li>
  );
}

/**
 * "Move to: Chemistry · Physics · Personal": where a note in the Inbox may belong. The first is
 * filled in when Milo is sure; nothing moves until she clicks. Moving teaches the next guess.
 */
function MoveChoices({ task, suggestion, spaceById }: { task: Task; suggestion: SpaceSuggestion; spaceById: Map<string, Space> }) {
  const update = useUpdateTask();
  const move = (spaceId: string) => {
    const name = spaceById.get(spaceId)?.name ?? "that space";
    update(task.id, { spaceId, sectionId: null });
    // No notice: she clicked the space by name and sees the note leave. Ctrl+Z brings it back.
    useUi.getState().remember(`Moved to ${name}`, () => update(task.id, { spaceId: INBOX_ID, sectionId: null }));
  };
  return (
    <div className="todo-move" role="group" aria-label={`Move ${task.title || "this note"} to`}>
      <span className="muted small">Move to</span>
      {suggestion.choices.map((c, i) => {
        const s = spaceById.get(c.spaceId);
        if (!s) return null;
        return (
          <button
            key={c.spaceId}
            className={`chip move-chip${i === 0 && suggestion.sure ? " sure" : ""}`}
            style={{ ["--c" as string]: colorVar(s.color) }}
            title={i === 0 && suggestion.why ? `Suggested: ${suggestion.why}` : undefined}
            onClick={() => move(c.spaceId)}
          >
            <i className="chip-dot" />
            {s.name}
          </button>
        );
      })}
    </div>
  );
}

/** One-click choices with a label: "Part: 02 Titration · 03 Redox". The first is filled in when sure. */
export function Choices({ label, items, sure, why, onPick }: {
  label: string;
  items: { id: string; name: string; color?: string }[];
  sure?: boolean;
  why?: string | null;
  onPick: (id: string) => void;
}) {
  if (!items.length) return null;
  return (
    <div className="todo-move" role="group" aria-label={label}>
      <span className="muted small">{label}</span>
      {items.map((it, i) => (
        <button
          key={it.id}
          type="button"
          className={`chip move-chip${i === 0 && sure ? " sure" : ""}`}
          style={it.color ? { ["--c" as string]: colorVar(it.color) } : undefined}
          title={i === 0 && why ? `Suggested: ${why}` : undefined}
          onClick={() => onPick(it.id)}
        >
          {it.color && <i className="chip-dot" />}
          {it.name}
        </button>
      ))}
    </div>
  );
}

/** "tandarts" on Tuesday at 14:30 is an appointment: one click puts it in the calendar instead. */
function CalendarOffer({ task, space }: { task: Task; space?: Space }) {
  const act = useAction("events", "tasks");
  const minutes = useUi((s) => s.prefs.eventMinutes);
  if (!space || !task.deadlineAt) return null;
  const start = new Date(task.deadlineAt);
  const put = () =>
    act.mutate(async () => {
      const ev = await api.createEvent({
        spaceId: space.id, activityId: null, title: task.title, notes: task.notes, allDay: false, status: "planned",
        startAt: start.toISOString(), endAt: new Date(start.getTime() + minutes * 60_000).toISOString(),
      });
      await api.setArchived("task", task.id, true);
      useUi.getState().notify({
        text: `In the calendar: ${fmtMoment(start)}, ${space.name}`,
        undo: () => act.mutate(async () => {
          await api.setArchived("event", ev.id, true);
          await api.setArchived("task", task.id, false);
        }),
      });
    });
  return (
    <div className="todo-move">
      <button className="chip move-chip" style={{ ["--c" as string]: colorVar(space.color) }} onClick={put}>
        <i className="chip-dot" />
        Put in the calendar · {fmtMoment(start)} · {space.name}
      </button>
    </div>
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
