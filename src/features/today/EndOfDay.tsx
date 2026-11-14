import { useInsights, useTasks } from "../../lib/queries";
import { addDays, daysFromToday, fmtTime, startOfDay, toDateInput } from "../../lib/time";
import type { CalEvent } from "../../lib/types";
import { fmtMinutes } from "../insights/Charts";

/** From this hour Today looks back on the day and ahead to tomorrow. */
const EVENING_FROM = 17;

/** A short close of the day: what happened, and what tomorrow starts with. No score. */
export function EndOfDay({ now, events }: { now: Date; events: CalEvent[] }) {
  const day = startOfDay(now);
  const tomorrow = addDays(day, 1);
  const data = useInsights(toDateInput(day), toDateInput(tomorrow)).data;
  const tasks = useTasks().data ?? [];
  if (now.getHours() < EVENING_FROM || !data) return null;

  const productive = data.totals.class + data.totals.selfStudy;
  const doneToday = tasks.filter((t) => t.completedAt && daysFromToday(new Date(t.completedAt)) === 0).length;
  const first = events
    .filter((e) => !e.allDay && e.status !== "skipped" && new Date(e.startAt) >= tomorrow && new Date(e.startAt) < addDays(tomorrow, 1))
    .sort((a, b) => a.startAt.localeCompare(b.startAt))[0];
  const dueTomorrow = tasks.filter((t) => !t.completedAt && t.deadlineAt && daysFromToday(new Date(t.deadlineAt)) === 1);

  const today: string[] = [];
  if (productive > 0) today.push(`${fmtMinutes(productive)} productive`);
  if (doneToday > 0) today.push(`${doneToday} ${doneToday === 1 ? "task" : "tasks"} done`);

  return (
    <section className="block end-of-day">
      <h2>End of the day</h2>
      <p>{today.length ? `Today: ${today.join(" · ")}.` : "A quiet day in the calendar."}</p>
      <p className="muted">
        {first ? `Tomorrow starts with ${first.title || "an event"} at ${fmtTime(new Date(first.startAt))}.` : "Nothing planned for tomorrow yet."}
        {dueTomorrow.length > 0 && ` Due tomorrow: ${dueTomorrow.map((t) => t.title || "Untitled").join(", ")}.`}
      </p>
    </section>
  );
}
