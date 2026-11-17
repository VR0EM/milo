import { addDays, minutesIntoDay } from "../../lib/time";

export interface Timed {
  id: string;
  start: Date;
  end: Date;
}

export interface Segment<T extends Timed> {
  item: T;
  /** Minutes from local midnight, clipped to this day. */
  top: number;
  bottom: number;
  /** Place among events that start together, side by side: `col` of `cols`. */
  col: number;
  cols: number;
  /** How deep it sits on top of earlier, longer events: each level is drawn a little to the right. */
  level: number;
  startsHere: boolean;
  endsHere: boolean;
}

/**
 * The part of each event that falls on `day`, laid out as in Notion's calendar:
 * - events that start together (closer than `titleMinutes`: the room the first one's title
 *   and time take, so a later one would cover them) share the width side by side;
 * - an event that starts while another is running is drawn on top of it, one level further
 *   to the right, so the one underneath keeps its title and its left edge in view.
 * An event that crosses midnight (sleep) yields one segment per day. `minMinutes` is also the
 * shortest an event is drawn, so a five-minute event takes the room it is drawn with.
 */
export function layoutDay<T extends Timed>(items: T[], day: Date, minMinutes = 0, titleMinutes = minMinutes): Segment<T>[] {
  const dayEnd = addDays(day, 1);
  const segs: Segment<T>[] = [];
  for (const item of items) {
    if (item.end <= day || item.start >= dayEnd) continue;
    const startsHere = item.start >= day;
    const endsHere = item.end <= dayEnd;
    segs.push({
      item,
      top: startsHere ? minutesIntoDay(item.start) : 0,
      bottom: endsHere && item.end < dayEnd ? minutesIntoDay(item.end) : 1440,
      col: 0,
      cols: 1,
      level: 0,
      startsHere,
      endsHere,
    });
  }
  // Earlier first; of two that start together, the longer one first (it goes underneath).
  segs.sort((a, b) => a.top - b.top || b.bottom - a.bottom);

  interface Group { top: number; bottom: number; level: number; members: Segment<T>[] }
  const groups: Group[] = [];
  const together = Math.max(titleMinutes, 1);
  for (const s of segs) {
    const drawnBottom = Math.max(s.bottom, s.top + minMinutes);
    const running = groups.filter((g) => g.bottom > s.top);
    // The latest running group it starts together with, if any.
    const join = [...running].reverse().find((g) => s.top - g.top < together);
    if (join) {
      join.members.push(s);
      join.bottom = Math.max(join.bottom, drawnBottom);
      s.level = join.level;
    } else {
      s.level = running.length ? Math.max(...running.map((g) => g.level)) + 1 : 0;
      groups.push({ top: s.top, bottom: drawnBottom, level: s.level, members: [s] });
    }
  }
  for (const g of groups) {
    g.members.forEach((m, i) => {
      m.col = i;
      m.cols = g.members.length;
    });
  }
  return segs;
}

/**
 * Start and end while one edge of an event is pulled to `t` and the other stays at `fixed`.
 * Pulled past the fixed edge, the event turns over (the old start becomes the end, or the
 * other way round); right on it, the event keeps `shortest` on the side it was.
 */
export function turnOver(fixed: number, t: number, pulling: "start" | "end", shortest: number): [number, number] {
  if (t > fixed) return [fixed, t];
  if (t < fixed) return [t, fixed];
  return pulling === "end" ? [fixed, fixed + shortest] : [fixed - shortest, fixed];
}
