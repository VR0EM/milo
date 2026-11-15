// Which to-dos are on Today, which are left from an earlier day, and the smart lists of the
// Tasks overview. Plain functions over the task list, so they can be tested.

import { addDays, startOfDay, toDateInput } from "./time";
import type { Task } from "./types";

const dueDay = (t: Task) => (t.deadlineAt ? toDateInput(new Date(t.deadlineAt)) : null);

/**
 * Today's list: what was put on Today, and what is due today. Ticked-off ones stay (struck
 * through), so the list shows what the day held. Open ones first, then by deadline.
 */
export function todayList(tasks: Task[], now: Date): Task[] {
  const today = toDateInput(now);
  return tasks
    .filter((t) => t.todayOn === today || dueDay(t) === today)
    .sort(
      (a, b) =>
        Number(!!a.completedAt) - Number(!!b.completedAt) ||
        (a.deadlineAt ?? "9999").localeCompare(b.deadlineAt ?? "9999") ||
        a.sortOrder - b.sortOrder,
    );
}

/** Open to-dos that were put on an earlier day and not finished. */
export function leftOver(tasks: Task[], now: Date): Task[] {
  const today = toDateInput(now);
  return tasks.filter((t) => !t.completedAt && t.todayOn !== null && t.todayOn < today && dueDay(t) !== today);
}

/** Open to-dos past their deadline, oldest first. */
export function pastDeadline(tasks: Task[], now: Date): Task[] {
  return tasks
    .filter((t) => !t.completedAt && t.deadlineAt && new Date(t.deadlineAt) < now)
    .sort((a, b) => a.deadlineAt!.localeCompare(b.deadlineAt!));
}

/** Open to-dos due from now through the next `days` days, nearest first. */
export function upcoming(tasks: Task[], now: Date, days = 7): Task[] {
  const until = addDays(startOfDay(now), days + 1);
  return tasks
    .filter((t) => !t.completedAt && t.deadlineAt && new Date(t.deadlineAt) >= now && new Date(t.deadlineAt) < until)
    .sort((a, b) => a.deadlineAt!.localeCompare(b.deadlineAt!));
}

/** For the "What do you want to do today?" list: late ones and those due within `days`. */
export function dueSoon(tasks: Task[], now: Date, days = 7): Task[] {
  return [...pastDeadline(tasks, now), ...upcoming(tasks, now, days)];
}
