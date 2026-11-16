// What a search result says and where it leads; shared by Cmd+K and the search page.

import { useUi } from "../../lib/store";
import { fmtDateField, fmtMoment } from "../../lib/time";
import type { EventHit, SearchWhen, TaskHit } from "../../lib/types";

const when = (w: SearchWhen) => (w.allDay ? fmtDateField(new Date(w.startAt)) : fmtMoment(new Date(w.startAt)));

/** "next Mon 23 Nov, 09:00 · 13×", or "Tue 4 Mar 2025" for one in the past. */
export function eventWhen(h: EventHit): string {
  const parts: string[] = [];
  if (h.next) parts.push(h.count > 1 ? `next ${when(h.next)}` : when(h.next));
  else if (h.last) parts.push(h.count > 1 ? `last ${when(h.last)}` : when(h.last));
  if (h.count > 1) parts.push(`${h.count}×`);
  return parts.join(" · ");
}

export function taskWhen(t: TaskHit): string {
  if (t.completedAt) return `done ${fmtDateField(new Date(t.completedAt))}`;
  return t.deadlineAt ? `due ${fmtMoment(new Date(t.deadlineAt))}` : "";
}

/** The calendar on that day, with the event open. */
export function openEvent(w: SearchWhen) {
  const ui = useUi.getState();
  ui.setView("calendar");
  if (ui.calMode === "month") ui.setCalMode("week");
  ui.showDate(new Date(w.startAt));
  ui.select(w.eventId);
}

/** The to-do open beside Tasks. */
export function openTask(id: string) {
  const ui = useUi.getState();
  ui.setView("tasks");
  ui.selectTask(id);
}
