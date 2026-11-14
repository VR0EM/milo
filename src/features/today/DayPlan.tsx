import { colorVar } from "../../lib/colors";
import { useImportSources } from "../../lib/queries";
import { useUi } from "../../lib/store";
import { addDays, fmtDuration, fmtTime, fmtWeekday, daysFromToday, startOfDay } from "../../lib/time";
import type { CalEvent, Space } from "../../lib/types";
import { SpaceMark } from "../../components/Icon";

/** "Wed", or "Wed 18 Nov" when it is more than a week away. */
const fmtWeekdayShort = (d: Date) =>
  daysFromToday(d) < 7 ? fmtWeekday(d) : `${fmtWeekday(d)} ${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" })}`;

const openInCalendar = (e: CalEvent) => {
  const ui = useUi.getState();
  ui.setView("calendar");
  ui.setCalMode("day");
  ui.showDate(new Date(e.startAt));
  ui.select(e.id);
};

/**
 * The whole day at a glance: all-day items, then every event with its time. What is over is
 * quiet, what runs now shows how much is left, and a line marks where now is.
 */
export function DayPlan({ now, events, spaceById }: { now: Date; events: CalEvent[]; spaceById: Map<string, Space> }) {
  const sources = useImportSources().data ?? [];
  const dayStart = startOfDay(now);
  const tomorrow = addDays(dayStart, 1);
  const shown = events.filter((e) => e.status !== "skipped");
  const allDay = shown.filter((e) => e.allDay && new Date(e.startAt) < tomorrow && new Date(e.endAt) > dayStart);
  const timed = shown
    .filter((e) => !e.allDay && new Date(e.startAt) < tomorrow && new Date(e.endAt) > dayStart)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const later = timed.filter((e) => new Date(e.startAt) > now);
  const nextTomorrow = shown
    .filter((e) => !e.allDay && new Date(e.startAt) >= tomorrow && new Date(e.startAt) < addDays(tomorrow, 1))
    .sort((a, b) => a.startAt.localeCompare(b.startAt))[0];

  // Where the "now" line goes: before the first event that has not started yet.
  const markerAt = timed.findIndex((e) => new Date(e.startAt) > now);
  const marker = (
    <li key="now" className="now-marker" aria-label={`Now, ${fmtTime(now)}`}>
      <span>now · {fmtTime(now)}</span>
    </li>
  );

  return (
    <section className="block day-plan">
      <div className="block-head">
        <h2>Your day</h2>
        <span className="muted small">
          {timed.length === 0 && allDay.length === 0 ? "" : later.length ? `${later.length} more today` : "nothing more today"}
        </span>
      </div>

      {allDay.length > 0 && (
        <div className="today-allday">
          <span className="muted small">All day</span>
          {allDay.map((e) => {
            const last = new Date(new Date(e.endAt).getTime() - 1);
            return (
              <button
                key={e.id}
                className="task-chip allday-event"
                style={{ ["--c" as string]: colorVar(spaceById.get(e.spaceId)?.color ?? "gray") }}
                title="Open in the calendar"
                onClick={() => openInCalendar(e)}
              >
                <span className="chip-title">{e.title || "Untitled"}</span>
                {startOfDay(last) > dayStart && <span className="chip-kind">until {fmtWeekdayShort(last)}</span>}
              </button>
            );
          })}
        </div>
      )}

      {timed.length === 0 ? (
        <div className="day-empty">
          <p className="muted">Nothing in the calendar today.</p>
          <div className="inline">
            <button className="btn small" onClick={() => useUi.getState().setView("calendar")}>Open the calendar</button>
            {sources.length === 0 && (
              <button className="link" onClick={() => useUi.getState().openSettings("import")}>Import your timetable</button>
            )}
          </div>
        </div>
      ) : (
        <ul className="day-list">
          {timed.flatMap((e, i) => {
            const start = new Date(e.startAt);
            const end = new Date(e.endAt);
            const past = end <= now;
            const running = start <= now && end > now;
            const space = spaceById.get(e.spaceId);
            const done = running ? (now.getTime() - start.getTime()) / (end.getTime() - start.getTime()) : 0;
            const row = (
              <li key={e.id}>
                <button
                  className={`day-row${past ? " past" : ""}${running ? " running" : ""}`}
                  style={{ ["--c" as string]: colorVar(space?.color ?? "gray") }}
                  onClick={() => openInCalendar(e)}
                >
                  <span className="day-time tabular">{start < dayStart ? `until ${fmtTime(end)}` : fmtTime(start)}</span>
                  <SpaceMark icon={space?.icon} />
                  <span className="day-title">{e.title || "Untitled"}</span>
                  <span className="muted small day-space">{space?.name}</span>
                  <span className="spacer" />
                  <span className="muted small tabular">
                    {running
                      ? `${fmtDuration(end.getTime() - now.getTime())} left`
                      : !past && i === markerAt
                        ? `in ${fmtDuration(start.getTime() - now.getTime())}`
                        : fmtDuration(end.getTime() - start.getTime())}
                  </span>
                </button>
                {running && (
                  <div className="progress thin" role="progressbar" aria-label="Time passed" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(done * 100)} style={{ ["--c" as string]: colorVar(space?.color ?? "gray") }}>
                    <div style={{ width: `${done * 100}%` }} />
                  </div>
                )}
              </li>
            );
            return i === markerAt ? [marker, row] : [row];
          })}
          {markerAt === -1 && marker}
        </ul>
      )}

      {later.length === 0 && nextTomorrow && (
        <p className="muted small">
          Tomorrow starts with {nextTomorrow.title || "an event"} at {fmtTime(new Date(nextTomorrow.startAt))}.
        </p>
      )}
    </section>
  );
}
