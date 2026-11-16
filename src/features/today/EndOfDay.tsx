import { useInsights, useSpaces, useTasks } from "../../lib/queries";
import { addDays, daysFromToday, fmtTime, startOfDay, toDateInput } from "../../lib/time";
import type { CalEvent } from "../../lib/types";
import { fmtMinutes } from "../insights/Charts";

/** From this hour Today looks back on the day and ahead to tomorrow. */
const EVENING_FROM = 17;

/**
 * A short close of the day: what got done, what is planned for tomorrow, and what is due then.
 * No score, no streak.
 */
export function EndOfDay({ now, events }: { now: Date; events: CalEvent[] }) {
  const day = startOfDay(now);
  const tomorrow = addDays(day, 1);
  const data = useInsights(toDateInput(day), toDateInput(tomorrow)).data;
  const tasks = useTasks().data ?? [];
  const sleep = new Set((useSpaces().data ?? []).filter((s) => s.role === "sleep").map((s) => s.id));
  if (now.getHours() < EVENING_FROM || !data) return null;

  const productive = data.totals.class + data.totals.selfStudy;
  const doneToday = tasks.filter((t) => t.completedAt && daysFromToday(new Date(t.completedAt)) === 0).length;
  const planned = events
    .filter((e) => !e.allDay && e.status !== "skipped" && !sleep.has(e.spaceId))
    .filter((e) => new Date(e.startAt) >= tomorrow && new Date(e.startAt) < addDays(tomorrow, 1))
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const dueTomorrow = tasks.filter((t) => !t.completedAt && t.deadlineAt && daysFromToday(new Date(t.deadlineAt)) === 1);

  const today: string[] = [];
  if (doneToday > 0) today.push(`${doneToday} ${doneToday === 1 ? "to-do" : "to-dos"} done`);
  if (productive > 0) today.push(`${fmtMinutes(productive)} productive`);
  const first = planned[0];

  return (
    <section className="block end-of-day">
      <h2>End of the day</h2>
      <dl className="eod">
        <dt>Today</dt>
        <dd>{today.length ? today.join(" · ") : "A quiet day in the calendar"}</dd>
        <dt>Tomorrow</dt>
        <dd>
          {first
            ? `${planned.length} ${planned.length === 1 ? "thing" : "things"} planned, starting with ${first.title || "an event"} at ${fmtTime(new Date(first.startAt))}`
            : "Nothing planned yet"}
        </dd>
        {dueTomorrow.length > 0 && (
          <>
            <dt>Due tomorrow</dt>
            <dd>{dueTomorrow.map((t) => t.title || "Untitled").join(", ")}</dd>
          </>
        )}
      </dl>
    </section>
  );
}
