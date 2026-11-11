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
  col: number;
  cols: number;
  startsHere: boolean;
  endsHere: boolean;
}

/**
 * The part of each event that falls on `day`, with overlapping events packed
 * side by side. An event that crosses midnight (sleep) yields one segment per day.
 */
export function layoutDay<T extends Timed>(items: T[], day: Date): Segment<T>[] {
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
      startsHere,
      endsHere,
    });
  }
  segs.sort((a, b) => a.top - b.top || b.bottom - a.bottom);

  let cluster: Segment<T>[] = [];
  let columnEnds: number[] = [];
  let clusterEnd = -1;
  const close = () => {
    for (const s of cluster) s.cols = columnEnds.length;
    cluster = [];
    columnEnds = [];
  };
  for (const s of segs) {
    if (cluster.length && s.top >= clusterEnd) close();
    let col = columnEnds.findIndex((end) => end <= s.top);
    if (col === -1) col = columnEnds.length;
    columnEnds[col] = s.bottom;
    s.col = col;
    cluster.push(s);
    clusterEnd = Math.max(clusterEnd, s.bottom);
  }
  close();
  return segs;
}
