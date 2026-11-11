import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { TimeField } from "../../components/TimeField";
import { useArchiveWithUndo, useTaskAction, useUpdateTask } from "../../lib/queries";
import { useUi } from "../../lib/store";
import { fmtTime, fromInputs, toDateInput } from "../../lib/time";
import { type Space, type Task, type TaskInput, type TaskPart, type TaskType } from "../../lib/types";
import { deadlineLine } from "./TasksView";

interface Props {
  task: Task | null;
  spaces: Space[];
  types: TaskType[];
}

export function TaskPanel({ task, spaces, types }: Props) {
  return (
    <aside className="panel" aria-label="Task details">
      {task ? (
        <TaskForm key={task.id} task={task} spaces={spaces} types={types} />
      ) : (
        <p className="panel-empty">Select a task to see its details.</p>
      )}
    </aside>
  );
}

function TaskForm({ task, spaces, types }: { task: Task; spaces: Space[]; types: TaskType[] }) {
  const act = useTaskAction();
  const archive = useArchiveWithUndo();
  const focusTitle = useUi((s) => s.focusTitle);
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [newPart, setNewPart] = useState("");

  useEffect(() => {
    if (focusTitle) {
      titleRef.current?.focus();
      useUi.setState({ focusTitle: false });
    }
  }, [focusTitle]);

  const update = useUpdateTask();
  const save = (patch: Partial<TaskInput>) => update(task.id, patch);
  const due = deadlineLine(task);
  const spaceChoices = spaces.filter((s) => !s.deletedAt || s.id === task.spaceId);
  const typeChoices = types.filter((t) => !t.deletedAt || t.id === task.typeId);

  const addPart = () => {
    const text = newPart.trim();
    if (!text) return;
    setNewPart("");
    act.mutate(() => api.createTaskPart(task.id, text));
  };

  return (
    <form className="panel-form" onSubmit={(e) => e.preventDefault()}>
      <input
        ref={titleRef}
        className="title-input"
        placeholder="Untitled"
        aria-label="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title !== task.title && save({ title })}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      {due && <p className={`panel-sub${due.late ? " late" : ""}`}>{due.text}</p>}

      <div className="field-row">
        <label className="field">
          <span>Space</span>
          <select
            value={task.spaceId}
            onChange={(e) => {
              save({ spaceId: e.target.value });
              useUi.getState().setLastSpace(e.target.value);
            }}
          >
            {spaceChoices.map((s) => (
              <option key={s.id} value={s.id}>{s.name}{s.deletedAt ? " (archived)" : ""}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Type</span>
          <select value={task.typeId ?? ""} onChange={(e) => save({ typeId: e.target.value || null })}>
            <option value="">None</option>
            {typeChoices.map((t) => (
              <option key={t.id} value={t.id}>{t.name}{t.deletedAt ? " (archived)" : ""}</option>
            ))}
          </select>
        </label>
      </div>

      <MomentField label="Deadline" value={task.deadlineAt} onChange={(v) => save({ deadlineAt: v })} />
      <MomentField label="Aim to finish by" value={task.targetAt} onChange={(v) => save({ targetAt: v })} />

      <fieldset className="field parts">
        <legend>Parts</legend>
        <ul>
          {task.parts.map((p) => (
            <PartRow key={p.id} part={p} />
          ))}
        </ul>
        <div className="part-add">
          <input
            placeholder="Add a part, e.g. Chapter 1"
            aria-label="New part"
            value={newPart}
            onChange={(e) => setNewPart(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addPart()}
          />
          <button type="button" className="btn" onClick={addPart} disabled={!newPart.trim()}>Add</button>
        </div>
      </fieldset>

      <label className="field grow">
        <span>Notes</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== task.notes && save({ notes })} />
      </label>

      <div className="panel-foot">
        <button
          type="button"
          className="btn quiet"
          onClick={() => {
            archive("task", task.id, task.title || "Task");
            useUi.getState().selectTask(null);
          }}
        >
          Archive
        </button>
      </div>
    </form>
  );
}

function PartRow({ part }: { part: TaskPart }) {
  const act = useTaskAction();
  const archive = useArchiveWithUndo();
  const [title, setTitle] = useState(part.title);
  const commit = () => {
    const text = title.trim();
    if (!text) setTitle(part.title);
    else if (text !== part.title) act.mutate(() => api.updateTaskPart(part.id, text, part.weight));
  };
  return (
    <li className={`part-row${part.doneAt ? " done" : ""}`}>
      <input
        type="checkbox"
        aria-label={`${part.title} done`}
        checked={!!part.doneAt}
        onChange={(e) => {
          const done = e.target.checked;
          act.mutate(() => api.setPartDone(part.id, done));
        }}
      />
      <input
        className="part-title"
        aria-label="Part title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      <button type="button" className="link" onClick={() => archive("task_part", part.id, part.title)}>Archive</button>
    </li>
  );
}

/** A date with an optional time. Without a typed time it means the end of that day. */
function MomentField({ label, value, onChange }: { label: string; value: string | null; onChange: (v: string | null) => void }) {
  const d = value ? new Date(value) : null;
  const set = (date: string, time: string) => {
    if (!date) return onChange(null);
    const next = fromInputs(date, time);
    if (next) onChange(next.toISOString());
  };
  return (
    <div className="field-row moment">
      <label className="field">
        <span>{label}</span>
        <input type="date" value={d ? toDateInput(d) : ""} onChange={(e) => set(e.target.value, d ? fmtTime(d) : "23:59")} />
      </label>
      <label className="field time">
        <span>Time</span>
        {d ? <TimeField value={fmtTime(d)} onCommit={(t) => set(toDateInput(d), t)} /> : <input disabled placeholder="hh:mm" />}
      </label>
      {d && <button type="button" className="link clear" onClick={() => onChange(null)}>Clear</button>}
    </div>
  );
}
