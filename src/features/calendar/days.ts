// The calendar renders a strip of days: the visible ones plus BUFFER days on each side,
// so free horizontal scrolling never shows an empty column.

import { addDays, sameDay } from "../../lib/time";

export const BUFFER = 7;

const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

/** The day `n` shown days after `d` (before, when negative). Without weekends, Sat and Sun are skipped. */
export function shiftShown(d: Date, n: number, weekends: boolean): Date {
  if (weekends) return addDays(d, n);
  let x = d;
  const step = n < 0 ? -1 : 1;
  for (let left = Math.abs(n); left > 0; ) {
    x = addDays(x, step);
    if (!isWeekend(x)) left--;
  }
  return x;
}

/** `d`, or the next day that is shown. */
export function firstShown(d: Date, weekends: boolean): Date {
  let x = d;
  while (!weekends && isWeekend(x)) x = addDays(x, 1);
  return x;
}

/** How many shown days lie from `a` to `b`, or null when they are more than `limit` apart. */
export function shownDistance(a: Date, b: Date, weekends: boolean, limit: number): number | null {
  if (sameDay(a, b)) return 0;
  for (const dir of [1, -1]) {
    let x = a;
    for (let i = 1; i <= limit; i++) {
      x = shiftShown(x, dir, weekends);
      if (sameDay(x, b)) return dir * i;
    }
  }
  return null;
}
