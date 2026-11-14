import type { Space } from "./types";

/**
 * The space new things go to when nothing more specific says so: the one asked for (often the
 * one used last), else Personal, else the first space outside a group, else any. Never an
 * archived one. Not simply "the first space": dragging spaces around in the sidebar would then
 * change where new events, notes and imports land.
 */
export function pickDefaultSpace(spaces: Space[], preferredId?: string | null): Space | undefined {
  const active = spaces.filter((s) => !s.deletedAt);
  return (
    active.find((s) => s.id === preferredId) ??
    active.find((s) => s.id === "seed-space-personal") ??
    active.find((s) => !s.groupId) ??
    active[0]
  );
}
