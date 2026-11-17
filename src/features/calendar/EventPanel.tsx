import { useEffect, useRef, useState } from "react";
import { SidePanel } from "../../components/SidePanel";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useAction, useActiveFocus, useArchiveWithUndo, useImportSources, useReminderRules, useRoutineChecks, useRoutines, useTasks, useUpdateEvent } from "../../lib/queries";
import { beginFocus } from "../../lib/focus";
import { DateInput } from "../../components/DateInput";
import { TimeField } from "../../components/TimeField";
import { MiniMonth } from "./MiniMonth";
import { NextUp } from "./NextUp";
import { TaskTray } from "./TaskTray";
import { RepeatField } from "./RepeatField";
import { EarlierVersions } from "../history/EarlierVersions";
import { useUi } from "../../lib/store";
import { addDays, fmtDuration, fmtLongDay, fromInputs, sameDay, startOfDay, toDateInput, toTimeInput } from "../../lib/time";
import { type Activity, type CalEvent, type EventInput, type Space } from "../../lib/types";

interface Props {
  event: CalEvent | null;
  spaces: Space[];
  activities: Activity[];
}

export function EventPanel({ event, spaces, activities }: Props) {
  return (
    <SidePanel label="Event details">
      {event ? (
        <EventForm key={event.id} event={event} spaces={spaces} activities={activities} />
      ) : (
        <div className="panel-idle">
          <MiniMonth />
          <NextUp />
          <TaskTray />
        </div>
      )}
    </SidePanel>
  );
}

function EventForm({ event, spaces, activities }: { event: CalEvent; spaces: Space[]; activities: Activity[] }) {
  const update = useUpdateEvent();
  const archive = useArchiveWithUndo();
  const focusTitle = useUi((s) => s.focusTitle);
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(event.title);
  const [notes, setNotes] = useState(event.notes);
  const [location, setLocation] = useState(event.location);
  // Changed from elsewhere (a restored version, an undo, a sync): show the new text.
  useEffect(() => setTitle(event.title), [event.title]);
  useEffect(() => setNotes(event.notes), [event.notes]);
  useEffect(() => setLocation(event.location), [event.location]);

  useEffect(() => {
    if (focusTitle) {
      titleRef.current?.focus();
      titleRef.current?.select();
      useUi.setState({ focusTitle: false });
    }
  }, [focusTitle]);

  const start = new Date(event.startAt);
  const end = new Date(event.endAt);
  const save = (patch: Partial<EventInput>) => update.mutate({ id: event.id, patch });
  const setTimes = (s: Date, e: Date) => save({ startAt: s.toISOString(), endAt: e.toISOString() });

  // Moving the start keeps the duration; an end before the start means "the next day".
  const onStart = (date: string, time: string) => {
    const s = fromInputs(date, time);
    if (s) setTimes(s, new Date(s.getTime() + (end.getTime() - start.getTime())));
  };
  const onEnd = (time: string) => {
    let e = fromInputs(toDateInput(start), time);
    if (!e) return;
    if (e <= start) e = addDays(e, 1);
    setTimes(start, e);
  };

  // All-day events run from midnight to midnight; `end` is the midnight after the last day.
  const lastDay = new Date(end.getTime() - 1);
  const setAllDay = (on: boolean) => {
    const day = startOfDay(start);
    if (on) {
      const days = Math.max(1, Math.round((startOfDay(lastDay).getTime() - day.getTime()) / 86_400_000) + 1);
      save({ allDay: true, startAt: day.toISOString(), endAt: addDays(day, sameDay(start, lastDay) ? 1 : days).toISOString() });
    } else {
      const { dayStartHour, eventMinutes } = useUi.getState().prefs;
      const s = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.max(dayStartHour, 9));
      save({ allDay: false, startAt: s.toISOString(), endAt: new Date(s.getTime() + eventMinutes * 60_000).toISOString() });
    }
  };
  const onAllDayStart = (date: string) => {
    const s = fromInputs(date, "00:00");
    if (s) setTimes(s, addDays(s, Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000))));
  };
  const onUntil = (date: string) => {
    const last = fromInputs(date, "00:00");
    if (last) setTimes(start, addDays(last < start ? start : last, 1));
  };

  // A block of time for a task, and starting focus right from it.
  const task = (useTasks().data ?? []).find((t) => t.id === event.taskId) ?? null;
  const focusRunning = !!useActiveFocus().data;
  const focusAct = useAction("focus", "events");
  const nowMs = Date.now();
  const canFocus = !event.allDay && event.source !== "import" && end.getTime() > nowMs && !focusRunning;
  const startFocusHere = () => {
    const left = start.getTime() > nowMs ? end.getTime() - start.getTime() : end.getTime() - nowMs;
    focusAct.mutate(
      () =>
        beginFocus({
          spaceId: event.spaceId, activityId: event.activityId, taskId: event.taskId, title: event.title,
          plannedMinutes: Math.min(600, Math.max(1, Math.round(left / 60_000))), eventId: event.id,
        }),
    );
  };

  const spaceChoices = spaces.filter((s) => !s.deletedAt || s.id === event.spaceId);
  const activityChoices = activities.filter((a) => !a.deletedAt || a.id === event.activityId);

  return (
    <form className="panel-form" onSubmit={(e) => e.preventDefault()}>
      <input
        ref={titleRef}
        className="title-input"
        placeholder="Untitled"
        aria-label="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title !== event.title && save({ title })}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />

      <p className="panel-sub">
        {fmtLongDay(start)} · {event.allDay ? (sameDay(start, lastDay) ? "All day" : `until ${fmtLongDay(lastDay)}`) : fmtDuration(end.getTime() - start.getTime())}
        {event.location && <> · <span className="place">{event.location}</span></>}
      </p>

      {task && (
        <div className="task-link">
          <span className="muted">Time for</span>
          <button type="button" className="link" onClick={() => useUi.getState().selectTask(task.id)}>{task.title || "Untitled task"}</button>
        </div>
      )}
      {canFocus && (
        <button type="button" className="btn primary" onClick={startFocusHere}>
          Start focus
        </button>
      )}

      {/* Her order: the time, then the day, then whether it is all day. */}
      {event.allDay ? (
        <div className="field-row">
          <label className="field">
            <span>From</span>
            <DateInput value={toDateInput(start)} onChange={onAllDayStart} />
          </label>
          <label className="field">
            <span>Until</span>
            <DateInput value={toDateInput(lastDay)} min={toDateInput(start)} onChange={onUntil} />
          </label>
        </div>
      ) : (
        <>
          <div className="field-row">
            <label className="field">
              <span>Start</span>
              <TimeField value={toTimeInput(start)} onCommit={(t) => onStart(toDateInput(start), t)} />
            </label>
            <label className="field">
              <span>End{!sameDay(start, end) ? " (next day)" : ""}</span>
              <TimeField value={toTimeInput(end)} from={toTimeInput(start)} onCommit={onEnd} />
            </label>
          </div>
          <label className="field">
            <span>Date</span>
            <DateInput value={toDateInput(start)} onChange={(v) => onStart(v, toTimeInput(start))} />
          </label>
        </>
      )}
      <label className="check">
        <input type="checkbox" checked={event.allDay} onChange={(e) => setAllDay(e.target.checked)} />
        <span>All day</span>
      </label>

      {event.source !== "import" && <RepeatField key={event.seriesId ?? "none"} event={event} />}

      <label className="field">
        <span>Space</span>
        <select
          value={event.spaceId}
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
        <span>Activity</span>
        <select value={event.activityId ?? ""} onChange={(e) => save({ activityId: e.target.value || null })}>
          <option value="">None</option>
          {activityChoices.map((a) => (
            <option key={a.id} value={a.id}>{a.name}{a.deletedAt ? " (archived)" : ""}</option>
          ))}
        </select>
      </label>

      {!event.allDay && <ReminderField value={event.reminders} onChange={(reminders) => save({ reminders })} />}

      <label className="field">
        <span>Location</span>
        <input
          value={location}
          placeholder="e.g. ELL.01.01"
          onChange={(e) => setLocation(e.target.value)}
          onBlur={() => location.trim() !== event.location && save({ location: location.trim() })}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
      </label>

      <label className="field grow">
        <span>Description</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== event.notes && save({ notes })} />
      </label>

      <EventChecklist event={event} />

      <label className="check">
        <input
          type="checkbox"
          checked={event.status === "skipped"}
          onChange={(e) => save({ status: e.target.checked ? "skipped" : "planned" })}
        />
        <span>Did not happen</span>
      </label>

      {event.source === "import" && <ImportedNote event={event} />}

      <EarlierVersions entity="event" item={event} />

      <div className="panel-foot">
        <button
          type="button"
          className="btn quiet"
          onClick={() => {
            archive("event", event.id, event.title || "Event");
            useUi.getState().select(null);
          }}
        >
          Archive
        </button>
      </div>
    </form>
  );
}

function ImportedNote({ event }: { event: CalEvent }) {
  const sources = useImportSources().data ?? [];
  const name = sources.find((s) => s.id === event.sourceId)?.name ?? "a calendar";
  const qc = useQueryClient();
  return (
    <div className="imported-note">
      <span>Imported from {name}.</span>
      {event.locallyModified ? (
        <>
          <span>You changed this event, so syncing leaves it as it is.</span>
          <button
            type="button"
            className="link"
            style={{ alignSelf: "flex-start" }}
            onClick={async () => {
              await api.followImport(event.id);
              qc.invalidateQueries({ queryKey: ["events"] });
              useUi.getState().notify({ text: "This event follows the calendar again from the next sync" });
            }}
          >
            Follow the calendar again
          </button>
        </>
      ) : (
        <span>If you change it, your version is kept when the calendar syncs.</span>
      )}
    </div>
  );
}

/** Minutes before; null = as set in Reminders, "" = none. */
const REMIND_AT: [number, string][] = [[0, "At start"], [5, "5 min"], [10, "10 min"], [30, "30 min"], [60, "1 hour"]];

/** "As set" (the general rule), "None", or one or more moments before the start. */
function ReminderField({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const rule = (useReminderRules().data ?? []).find((r) => r.kind === "event");
  const chosen = value ? value.split(",").map(Number) : [];
  const general = rule?.enabled ? `${rule.minutesBefore ?? 10} min before` : "off";
  const toggle = (m: number) => {
    const next = chosen.includes(m) ? chosen.filter((x) => x !== m) : [...chosen, m];
    onChange(next.length ? next.sort((a, b) => a - b).join(",") : "");
  };
  return (
    <fieldset className="field">
      <legend>Reminder</legend>
      <div className="reminder-chips" role="group" aria-label="Reminder">
        <button type="button" className={`chip move-chip${value === null ? " sure" : ""}`} aria-pressed={value === null} title="The reminder for every event, set in Reminders" onClick={() => onChange(null)}>
          As usual ({general})
        </button>
        {REMIND_AT.map(([m, label]) => (
          <button type="button" key={m} className={`chip move-chip${chosen.includes(m) ? " sure" : ""}`} aria-pressed={chosen.includes(m)} onClick={() => toggle(m)}>
            {label}
          </button>
        ))}
        <button type="button" className={`chip move-chip${value === "" ? " sure" : ""}`} aria-pressed={value === ""} onClick={() => onChange("")}>
          None
        </button>
      </div>
    </fieldset>
  );
}

/** The checklist of the routine that belongs to this event's space, ticked per day. */
function EventChecklist({ event }: { event: CalEvent }) {
  const routine = (useRoutines().data ?? []).find((r) => r.spaceId === event.spaceId);
  const day = toDateInput(new Date(event.startAt));
  const checked = useRoutineChecks(day).data ?? [];
  const act = useAction("routineChecks");
  if (!routine || !routine.items.length) return null;
  const items = routine.items;
  const top = items.filter((i) => !i.parentId || !items.some((p) => p.id === i.parentId));
  const done = items.filter((i) => checked.includes(i.id)).length;
  const row = (id: string, title: string, sub: boolean) => (
    <li key={id} className={sub ? "sub" : undefined}>
      <label className={`check routine-item${checked.includes(id) ? " on" : ""}`}>
        <input
          type="checkbox"
          className="todo-check small"
          checked={checked.includes(id)}
          onChange={(e) => {
            const v = e.target.checked;
            act.mutate(() => api.setRoutineCheck(id, day, v));
          }}
        />
        <span>{title}</span>
      </label>
    </li>
  );
  return (
    <fieldset className="field">
      <legend>
        Checklist: {routine.name} <span className="muted small">{done} of {items.length}</span>
      </legend>
      <ul className="routine-list">
        {top.flatMap((i) => [row(i.id, i.title, false), ...items.filter((c) => c.parentId === i.id).map((c) => row(c.id, c.title, true))])}
      </ul>
    </fieldset>
  );
}
