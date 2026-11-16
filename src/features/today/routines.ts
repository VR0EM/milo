import { addDays, startOfDay, toDateInput } from "../../lib/time";
import type { CalEvent, Routine } from "../../lib/types";

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const weekday = (d: Date) => String(((d.getDay() + 6) % 7) + 1); // 1 = Monday

export interface ActiveRoutine {
  routine: Routine;
  /** The day the checks belong to. For a routine past midnight this is the day it started. */
  day: string;
  /** Until when it shows. */
  until: Date;
}

/** A routine of a space shows this long before an event of that space starts. */
const BEFORE_MS = 30 * 60_000;

/**
 * The routine to show now. One that follows a space comes first: it shows while an event of
 * that space runs, or starts within half an hour. Otherwise the one whose set times hold `now`.
 */
export function activeRoutine(routines: Routine[], now: Date, events: CalEvent[] = []): ActiveRoutine | null {
  const t = now.getTime();
  for (const routine of routines.filter((r) => r.spaceId)) {
    const event = events
      .filter((e) => e.spaceId === routine.spaceId && !e.deletedAt && e.status !== "skipped" && !e.allDay)
      .filter((e) => new Date(e.startAt).getTime() - BEFORE_MS <= t && t < new Date(e.endAt).getTime())
      .sort((a, b) => a.startAt.localeCompare(b.startAt))[0];
    if (event) return { routine, day: toDateInput(new Date(event.startAt)), until: new Date(event.endAt) };
  }
  const m = now.getHours() * 60 + now.getMinutes();
  const today = startOfDay(now);
  const at = (day: Date, hhmm: string) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), Number(hhmm.slice(0, 2)), Number(hhmm.slice(3)));
  for (const routine of routines.filter((r) => !r.spaceId)) {
    const start = minutes(routine.startTime);
    const end = minutes(routine.endTime);
    const wraps = end < start;
    if (!wraps && m >= start && m < end && routine.weekdays.includes(weekday(today))) {
      return { routine, day: toDateInput(today), until: at(today, routine.endTime) };
    }
    if (wraps) {
      if (m >= start && routine.weekdays.includes(weekday(today))) return { routine, day: toDateInput(today), until: at(addDays(today, 1), routine.endTime) };
      const yesterday = addDays(today, -1);
      if (m < end && routine.weekdays.includes(weekday(yesterday))) return { routine, day: toDateInput(yesterday), until: at(today, routine.endTime) };
    }
  }
  return null;
}

/** The next routine that still starts today. */
export function nextRoutine(routines: Routine[], now: Date): Routine | null {
  const m = now.getHours() * 60 + now.getMinutes();
  const day = weekday(now);
  return (
    routines
      .filter((r) => r.weekdays.includes(day) && minutes(r.startTime) > m)
      .sort((a, b) => a.startTime.localeCompare(b.startTime))[0] ?? null
  );
}
