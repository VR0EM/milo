import { describe, expect, it } from "vitest";
import { pickDefaultSpace, spaceProgress } from "./spaces";
import type { Space, Task } from "./types";

const space = (id: string, extra: Partial<Space> = {}): Space => ({
  id, groupId: null, name: id, color: "blue", role: "normal", kind: "list", icon: null, sortOrder: 0, deletedAt: null, ...extra,
});

describe("pickDefaultSpace", () => {
  const chem = space("chem", { groupId: "school" });
  const personal = space("seed-space-personal");
  const sleep = space("sleep");

  it("takes the one asked for", () => {
    expect(pickDefaultSpace([chem, personal, sleep], "sleep")?.id).toBe("sleep");
  });

  it("falls back to Personal, not to whatever is first", () => {
    expect(pickDefaultSpace([chem, sleep, personal], null)?.id).toBe("seed-space-personal");
    expect(pickDefaultSpace([chem, sleep, personal], "gone")?.id).toBe("seed-space-personal");
  });

  it("then a space outside a group, then any", () => {
    expect(pickDefaultSpace([chem, sleep])?.id).toBe("sleep");
    expect(pickDefaultSpace([chem])?.id).toBe("chem");
  });

  it("never picks the hidden Inbox", () => {
    const inbox = space("seed-space-inbox", { kind: "inbox", sortOrder: -1 });
    expect(pickDefaultSpace([inbox, chem], "seed-space-inbox")?.id).toBe("chem");
  });

  it("never picks an archived space", () => {
    const old = space("old", { deletedAt: "2026-01-01T00:00:00Z" });
    expect(pickDefaultSpace([old, chem], "old")?.id).toBe("chem");
    expect(pickDefaultSpace([old])).toBeUndefined();
  });
});

describe("spaceProgress", () => {
  const task = (done: boolean, parts: [number, boolean][] = []): Task => ({
    id: Math.random().toString(), spaceId: "chem", typeId: null, title: "", notes: "", deadlineAt: null, targetAt: null,
    completedAt: done ? "2026-11-01T00:00:00Z" : null, priority: null, sectionId: null, todayOn: null, sourceId: null,
    locallyModified: false, sortOrder: 0, createdAt: "", parts: parts.map(([weight, d], i) => ({ id: String(i), taskId: "", title: "", weight, doneAt: d ? "x" : null, sortOrder: i })),
  });

  it("counts a to-do without parts as one", () => {
    expect(spaceProgress([task(true), task(false)])).toEqual({ done: 1, total: 2, share: 0.5 });
  });

  it("weighs the parts of a to-do", () => {
    // One plain to-do done (1 of 1) and one with parts 1 of 3 done: 2 of 4.
    expect(spaceProgress([task(true), task(false, [[1, true], [1, false], [1, false]])]).share).toBe(0.5);
  });

  it("is zero for no to-dos", () => {
    expect(spaceProgress([])).toEqual({ done: 0, total: 0, share: 0 });
  });
});
