import { addDays, startOfDay, toDateInput } from "../../lib/time";
import type { Routine } from "../../lib/types";

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const weekday = (d: Date) => String(((d.getDay() + 6) % 7) + 1); // 1 = Monday

export interface ActiveRoutine {
  routine: Routine;
  /** The day the checks belong to. For a routine past midnight this is the day it started. */
  day: string;
}

/** The routine whose time window contains `now`, if any. */
export function activeRoutine(routines: Routine[], now: Date): ActiveRoutine | null {
  const m = now.getHours() * 60 + now.getMinutes();
  const today = startOfDay(now);
  for (const routine of routines) {
    const start = minutes(routine.startTime);
    const end = minutes(routine.endTime);
    const wraps = end < start;
    if (!wraps && m >= start && m < end && routine.weekdays.includes(weekday(today))) {
      return { routine, day: toDateInput(today) };
    }
    if (wraps) {
      if (m >= start && routine.weekdays.includes(weekday(today))) return { routine, day: toDateInput(today) };
      const yesterday = addDays(today, -1);
      if (m < end && routine.weekdays.includes(weekday(yesterday))) return { routine, day: toDateInput(yesterday) };
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
