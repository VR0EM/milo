// What a quick note becomes: "labo chemie inleveren vrijdag 23u" is the to-do "labo chemie
// inleveren", due Friday at 23:00. Plain rules (noteHints.ts): the same note always gives the
// same result, and what the rules do not recognise stays in the title.

import { noteHints } from "./noteHints";
import type { Task } from "./types";

export interface ParsedNote {
  title: string;
  /** ISO moment; a day without a time means the end of that day. */
  deadlineAt: string | null;
  /** From a list after a colon: "verslag: inleiding, code, conclusie". */
  steps: string[];
}

export function parseNote(text: string, now = new Date()): ParsedNote {
  const h = noteHints(text, now, []);
  const head = h.parts ? h.rest.split(":")[0] : h.rest;
  const title = head.replace(/[\s,;:–-]+$/, "").trim() || text.trim();
  let deadlineAt: string | null = null;
  if (h.date) {
    const [y, m, d] = h.date.split("-").map(Number);
    const [hh, mm] = (h.time ?? "23:59").split(":").map(Number);
    deadlineAt = new Date(y, m - 1, d, hh, mm).toISOString();
  }
  return { title, deadlineAt, steps: h.parts ?? [] };
}

/**
 * A to-do that reads like an appointment ("tandarts", Tuesday 14:30): a set time, and no word
 * like "inleveren" or "due" that makes the time a deadline. Offered to put in the calendar.
 */
export function looksLikeAppointment(t: Task): boolean {
  if (!t.deadlineAt || t.completedAt) return false;
  const d = new Date(t.deadlineAt);
  if (d.getHours() === 23 && d.getMinutes() === 59) return false;
  return noteHints(t.title, new Date(), []).kind !== "task";
}
