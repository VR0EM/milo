// All-day events drawn as one bar over the days they cover, in the week's all-day row and in
// each week of the month view. Bars that overlap go on separate lines ("lanes").

import { addDays } from "../../lib/time";
import type { CalEvent } from "../../lib/types";

export interface Span {
  event: CalEvent;
  /** First and last column covered (inclusive). */
  from: number;
  to: number;
  lane: number;
  /** The event goes on before the first or after the last column shown here. */
  cutStart: boolean;
  cutEnd: boolean;
}

/** Bars for the all-day events over a row of days (one column per day, in order). */
export function layoutSpans(events: CalEvent[], days: Date[]): Span[] {
  const spans: Span[] = [];
  for (const event of events) {
    if (!event.allDay) continue;
    const start = new Date(event.startAt);
    const end = new Date(event.endAt);
    let from = -1;
    let to = -1;
    days.forEach((d, i) => {
      if (start < addDays(d, 1) && end > d) {
        if (from < 0) from = i;
        to = i;
      }
    });
    if (from < 0) continue;
    spans.push({ event, from, to, lane: 0, cutStart: start < days[from], cutEnd: end > addDays(days[to], 1) });
  }
  // Earliest first, longest first: long bars sit on the top lines and do not zigzag.
  spans.sort((a, b) => a.from - b.from || b.to - b.from - (a.to - a.from) || a.event.title.localeCompare(b.event.title));
  const laneEnds: number[] = [];
  for (const s of spans) {
    let lane = laneEnds.findIndex((end) => end < s.from);
    if (lane < 0) lane = laneEnds.push(s.to) - 1;
    else laneEnds[lane] = s.to;
    s.lane = lane;
  }
  return spans;
}

/** For each column, how many lanes the bars over it use (counting empty lanes above). */
export function lanesPerColumn(spans: Span[], columns: number): number[] {
  const out = new Array<number>(columns).fill(0);
  for (const s of spans) for (let i = s.from; i <= s.to; i++) out[i] = Math.max(out[i], s.lane + 1);
  return out;
}
