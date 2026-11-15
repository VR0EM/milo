import type { CalEvent, Space } from "./types";

/** While an event runs, the next one takes over this long before it starts (as in the menu bar). */
export const HANDOVER_MS = 15 * 60_000;

/** Events that count as "something coming up": not all-day, not skipped, no focus or sleep. */
export function countsAsNext(e: CalEvent, spaceById: Map<string, Space>) {
  return !e.allDay && !e.deletedAt && e.status !== "skipped" && e.source !== "focus" && spaceById.get(e.spaceId)?.role !== "sleep";
}

/**
 * The event to point at now: the one running, unless the next starts within a quarter of an
 * hour; else the next one. The same rule as the text in the menu bar (src-tauri/src/menubar.rs).
 */
export function pickNext(events: CalEvent[], spaces: Space[], now: Date): CalEvent | null {
  const spaceById = new Map(spaces.map((s) => [s.id, s]));
  const t = now.getTime();
  const list = events
    .filter((e) => countsAsNext(e, spaceById) && new Date(e.endAt).getTime() > t)
    .sort((a, b) => a.startAt.localeCompare(b.startAt) || a.endAt.localeCompare(b.endAt));
  const started = list.filter((e) => new Date(e.startAt).getTime() <= t);
  const running = started[started.length - 1] ?? null;
  const next = list.find((e) => new Date(e.startAt).getTime() > t) ?? null;
  if (running && next && new Date(next.startAt).getTime() - t <= HANDOVER_MS) return next;
  return running ?? next;
}

/** "25 min", "1 h 10", "2 h"; partial minutes count as a whole one. */
export function fmtSpan(ms: number) {
  const m = Math.max(1, Math.ceil(ms / 60_000));
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h === 0 ? `${r} min` : r === 0 ? `${h} h` : `${h} h ${String(r).padStart(2, "0")}`;
}

/** "in 25 min", "now", or "40 min left" while it runs. */
export function fmtUntil(e: CalEvent, now: Date) {
  const start = new Date(e.startAt).getTime();
  const t = now.getTime();
  if (start > t) return start - t < 60_000 ? "now" : `in ${fmtSpan(start - t)}`;
  return `${fmtSpan(new Date(e.endAt).getTime() - t)} left`;
}
