import { useEffect, useRef, useState } from "react";
import { SidePanel } from "../../components/SidePanel";
import { api } from "../../lib/api";
import { TimeField } from "../../components/TimeField";
import { DateInput } from "../../components/DateInput";
import { PRIORITIES, PriorityMark } from "../../components/PriorityMark";
import { useArchiveWithUndo, useEvents, useImportSources, useInSpaceSuggestions, useSections, useTaskAction, useUpdateTask } from "../../lib/queries";
import { useUi } from "../../lib/store";
import { addDays, fmtDuration, fmtRange, fromInputs, startOfDay, toDateInput, toTimeInput } from "../../lib/time";
import { INBOX_ID, type CalEvent, type Space, type Task, type TaskInput, type TaskPart, type TaskType } from "../../lib/types";
import { Choices, isOnToday, useSetToday } from "./Todo";
import { deadlineLine } from "./TasksView";
import { EarlierVersions } from "../history/EarlierVersions";

interface Props {
  task: Task | null;
  spaces: Space[];
  types: TaskType[];
}

export function TaskPanel({ task, spaces, types }: Props) {
  return (
    <SidePanel label="To-do details">
      {task ? (
        <TaskForm key={task.id} task={task} spaces={spaces} types={types} />
      ) : (
        <p className="panel-empty">Select a to-do to see its details.</p>
      )}
    </SidePanel>
  );
}

function TaskForm({ task, spaces, types }: { task: Task; spaces: Space[]; types: TaskType[] }) {
  const act = useTaskAction();
  const archive = useArchiveWithUndo();
  const focusTitle = useUi((s) => s.focusTitle);
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  // Changed from elsewhere (a restored version): show the new text.
  useEffect(() => setTitle(task.title), [task.title]);
  useEffect(() => setNotes(task.notes), [task.notes]);
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
  const setToday = useSetToday();
  const onToday = isOnToday(task);
  const sections = (useSections().data ?? []).filter((x) => x.spaceId === task.spaceId);
  // To-dos live in courses, lists and the Inbox; a time-only space only when it already is there.
  const spaceChoices = spaces.filter(
    (s) => s.id === task.spaceId || (!s.deletedAt && (s.kind === "project" || s.kind === "list")),
  );
  const inboxListed = spaceChoices.some((s) => s.id === INBOX_ID);
  const typeChoices = types.filter((t) => t.id === task.typeId || (!t.deletedAt && (!t.spaceId || t.spaceId === task.spaceId)));
  const inCourse = spaces.find((s) => s.id === task.spaceId)?.kind === "project" && !task.completedAt && !!task.title;
  const partHint = useInSpaceSuggestions(task.spaceId, "section", [task], inCourse && !task.sectionId && sections.length > 0).data?.get(task.id);
  const typeHint = useInSpaceSuggestions(task.spaceId, "type", [task], inCourse && !task.typeId).data?.get(task.id);
  const hint = (s: typeof partHint, names: Map<string, string>) =>
    s?.choices.slice(0, 2).map((c) => ({ id: c.spaceId, name: names.get(c.spaceId) ?? "" })).filter((c) => c.name) ?? [];
  const typeNames = new Map(typeChoices.map((t) => [t.id, t.name]));
  const partNames = new Map(sections.map((x) => [x.id, x.name]));

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

      {!task.completedAt && (
        <label className="switch-control today-switch">
          <input type="checkbox" role="switch" checked={onToday} onChange={(e) => setToday(task, e.target.checked)} />
          <span>On Today</span>
        </label>
      )}

      <PlannedTime task={task} />

      <div className="field-row">
        <label className="field">
          <span>Space</span>
          <select
            value={task.spaceId}
            onChange={(e) => {
              save({ spaceId: e.target.value, sectionId: null });
              if (e.target.value !== INBOX_ID) useUi.getState().setLastSpace(e.target.value);
            }}
          >
            {!inboxListed && <option value={INBOX_ID}>Inbox</option>}
            {spaceChoices.map((s) => (
              <option key={s.id} value={s.id}>{s.kind === "inbox" ? "Inbox" : s.name}{s.deletedAt ? " (archived)" : ""}</option>
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
      {!task.typeId && <Choices label="Type?" items={hint(typeHint, typeNames)} sure={typeHint?.sure} why={typeHint?.why} onPick={(id) => save({ typeId: id })} />}
      {sections.length > 0 && (
        <label className="field">
          <span>Part of the course</span>
          <select value={task.sectionId ?? ""} onChange={(e) => save({ sectionId: e.target.value || null })}>
            <option value="">No part</option>
            {sections.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
      )}
      {!task.sectionId && <Choices label="Part?" items={hint(partHint, partNames)} sure={partHint?.sure} why={partHint?.why} onPick={(id) => save({ sectionId: id })} />}

      <div className="field">
        <span>Priority</span>
        <div className="segmented prio-picker" role="radiogroup" aria-label="Priority">
          <button type="button" role="radio" aria-checked={!task.priority} className={!task.priority ? "on" : ""} onClick={() => save({ priority: null })}>None</button>
          {PRIORITIES.map(([p, label]) => (
            <button key={p} type="button" role="radio" aria-checked={task.priority === p} className={task.priority === p ? "on" : ""} onClick={() => save({ priority: p })}>
              <PriorityMark priority={p} label={false} />
              {label}
            </button>
          ))}
        </div>
      </div>

      <MomentField label="Deadline" value={task.deadlineAt} onChange={(v) => save({ deadlineAt: v })} />
      <MomentField label="Aim to finish by" value={task.targetAt} onChange={(v) => save({ targetAt: v })} />

      <fieldset className="field parts">
        <legend>Steps</legend>
        <ul>
          {task.parts.map((p) => (
            <PartRow key={p.id} part={p} />
          ))}
        </ul>
        <div className="part-add">
          <input
            placeholder="Add a step, e.g. Chapter 1"
            aria-label="New step"
            value={newPart}
            onChange={(e) => setNewPart(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addPart()}
          />
          <button type="button" className="btn" onClick={addPart} disabled={!newPart.trim()}>Add</button>
        </div>
      </fieldset>

      {task.sourceId && <ImportedTaskNote task={task} />}

      <label className="field grow">
        <span>Notes</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== task.notes && save({ notes })} />
      </label>

      <EarlierVersions entity="task" item={task} />

      <div className="panel-foot">
        <button
          type="button"
          className="btn quiet"
          onClick={() => {
            archive("task", task.id, task.title || "To-do");
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
        aria-label="Step title"
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
        <DateInput value={d ? toDateInput(d) : ""} placeholder="No date" onChange={(v) => set(v, d ? toTimeInput(d) : "23:59")} />
      </label>
      <label className="field time">
        <span>Time</span>
        {d ? <TimeField value={toTimeInput(d)} onCommit={(t) => set(toDateInput(d), t)} /> : <input disabled placeholder="hh:mm" />}
      </label>
      {d && <button type="button" className="link clear" onClick={() => onChange(null)}>Clear</button>}
    </div>
  );
}

function ImportedTaskNote({ task }: { task: Task }) {
  const sources = useImportSources().data ?? [];
  const name = sources.find((s) => s.id === task.sourceId)?.name ?? "a calendar";
  return (
    <div className="imported-note">
      <span>Imported from {name}.</span>
      <span>
        {task.locallyModified
          ? "You changed this task, so syncing leaves it as it is."
          : "If you change it, your version is kept when the calendar syncs. Ticking it off is always yours."}
      </span>
    </div>
  );
}

const PLAN_BACK_DAYS = 90;
const PLAN_AHEAD_DAYS = 60;
const blockDay = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });

/** Time set aside for this task in the calendar: what is coming, and what was spent. */
function PlannedTime({ task }: { task: Task }) {
  const [from, to] = useState(() => {
    const today = startOfDay(new Date());
    return [addDays(today, -PLAN_BACK_DAYS), addDays(today, PLAN_AHEAD_DAYS)];
  })[0];
  const events = (useEvents(from, to).data ?? []).filter((e) => e.taskId === task.id && e.status !== "skipped");
  const now = Date.now();
  const coming = events.filter((e) => new Date(e.endAt).getTime() > now);
  const spent = events
    .filter((e) => new Date(e.endAt).getTime() <= now)
    .reduce((sum, e) => sum + new Date(e.endAt).getTime() - new Date(e.startAt).getTime(), 0);

  const open = (e: CalEvent) => {
    const ui = useUi.getState();
    ui.setView("calendar");
    if (ui.calMode === "month") ui.setCalMode("week");
    ui.showDate(new Date(e.startAt));
    ui.select(e.id);
  };
  const plan = () => {
    const ui = useUi.getState();
    ui.setView("calendar");
    if (ui.calMode === "month") ui.setCalMode("week");
    ui.selectTask(null);
    useUi.setState({ planTaskId: task.id });
  };

  return (
    <div className="planned-time">
      <div className="planned-head">
        <span className="field-label">Planned time</span>
        {spent >= 60_000 && <span className="muted small">{fmtDuration(spent)} spent</span>}
        <span className="spacer" />
        <button type="button" className="btn small" onClick={plan}>Plan time</button>
      </div>
      {coming.length === 0 ? (
        <p className="muted small">Nothing planned yet. Drag the task onto the calendar to set time aside.</p>
      ) : (
        <ul>
          {coming.slice(0, 3).map((e) => (
            <li key={e.id}>
              <button type="button" className="planned-block" onClick={() => open(e)}>
                <span>{blockDay.format(new Date(e.startAt))}</span>
                <span className="muted tabular">{fmtRange(new Date(e.startAt), new Date(e.endAt))}</span>
              </button>
            </li>
          ))}
          {coming.length > 3 && <li className="muted small">{coming.length - 3} more</li>}
        </ul>
      )}
    </div>
  );
}
