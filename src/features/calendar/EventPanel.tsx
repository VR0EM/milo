import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useArchiveWithUndo, useImportSources, useUpdateEvent } from "../../lib/queries";
import { TimeField } from "../../components/TimeField";
import { MiniMonth } from "./MiniMonth";
import { useUi } from "../../lib/store";
import { addDays, fmtDuration, fmtLongDay, fmtTime, fromInputs, sameDay, startOfDay, toDateInput } from "../../lib/time";
import { type Activity, type CalEvent, type EventInput, type Space } from "../../lib/types";

interface Props {
  event: CalEvent | null;
  spaces: Space[];
  activities: Activity[];
}

export function EventPanel({ event, spaces, activities }: Props) {
  return (
    <aside className="panel" aria-label="Event details">
      {event ? (
        <EventForm key={event.id} event={event} spaces={spaces} activities={activities} />
      ) : (
        <div className="panel-idle">
          <MiniMonth />
          <p className="muted small">
            Select an event to see its details. Double-click the calendar, or press N, to plan a new one.
          </p>
        </div>
      )}
    </aside>
  );
}

function EventForm({ event, spaces, activities }: { event: CalEvent; spaces: Space[]; activities: Activity[] }) {
  const update = useUpdateEvent();
  const archive = useArchiveWithUndo();
  const focusTitle = useUi((s) => s.focusTitle);
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(event.title);
  const [notes, setNotes] = useState(event.notes);

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
      </p>

      <label className="check">
        <input type="checkbox" checked={event.allDay} onChange={(e) => setAllDay(e.target.checked)} />
        <span>All day</span>
      </label>
      {event.allDay ? (
      <div className="field-row">
        <label className="field">
          <span>From</span>
          <input type="date" value={toDateInput(start)} onChange={(e) => onAllDayStart(e.target.value)} />
        </label>
        <label className="field">
          <span>Until</span>
          <input type="date" value={toDateInput(lastDay)} min={toDateInput(start)} onChange={(e) => onUntil(e.target.value)} />
        </label>
      </div>
      ) : (
      <>
      <label className="field">
        <span>Date</span>
        <input type="date" value={toDateInput(start)} onChange={(e) => onStart(e.target.value, fmtTime(start))} />
      </label>
      <div className="field-row">
        <label className="field">
          <span>Start</span>
          <TimeField value={fmtTime(start)} onCommit={(t) => onStart(toDateInput(start), t)} />
        </label>
        <label className="field">
          <span>End{!sameDay(start, end) ? " (next day)" : ""}</span>
          <TimeField value={fmtTime(end)} onCommit={onEnd} />
        </label>
      </div>
      </>
      )}

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

      <label className="check">
        <input
          type="checkbox"
          checked={event.status === "skipped"}
          onChange={(e) => save({ status: e.target.checked ? "skipped" : "planned" })}
        />
        <span>Did not happen</span>
      </label>

      <label className="field grow">
        <span>Notes</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== event.notes && save({ notes })} />
      </label>

      {event.source === "import" && <ImportedNote event={event} />}

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
