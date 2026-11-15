import type { Space, Task } from "./types";

/**
 * The space new things go to when nothing more specific says so: the one asked for (often the
 * one used last), else Personal, else the first space outside a group, else any. Never an
 * archived one. Not simply "the first space": dragging spaces around in the sidebar would then
 * change where new events, notes and imports land.
 */
export function pickDefaultSpace(spaces: Space[], preferredId?: string | null): Space | undefined {
  const active = spaces.filter((s) => !s.deletedAt && s.kind !== "inbox");
  return (
    active.find((s) => s.id === preferredId) ??
    active.find((s) => s.id === "seed-space-personal") ??
    active.find((s) => !s.groupId) ??
    active[0]
  );
}

/** Spaces that hold to-dos: courses and lists (not time-only spaces, not the Inbox). */
export const todoSpaces = (spaces: Space[]) => spaces.filter((s) => !s.deletedAt && (s.kind === "project" || s.kind === "list"));

/** Done 0..1 over the to-dos of a course, by weight of their parts. */
export function spaceProgress(tasks: Task[]): { done: number; total: number; share: number } {
  const total = tasks.length;
  const done = tasks.filter((t) => t.completedAt).length;
  const weight = tasks.reduce((n, t) => n + (t.parts.length ? t.parts.reduce((m, p) => m + p.weight, 0) : 1), 0);
  const got = tasks.reduce(
    (n, t) => n + (t.parts.length ? t.parts.reduce((m, p) => m + (p.doneAt ? p.weight : 0), 0) : t.completedAt ? 1 : 0),
    0,
  );
  return { done, total, share: weight ? got / weight : 0 };
}
