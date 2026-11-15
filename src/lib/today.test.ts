import { describe, expect, it } from "vitest";
import { dueSoon, leftOver, pastDeadline, todayList, upcoming } from "./today";
import type { Task } from "./types";

const now = new Date(2026, 10, 18, 10, 0); // Wednesday 18 November, 10:00
const at = (day: number, h = 23, m = 59) => new Date(2026, 10, day, h, m).toISOString();
const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id, spaceId: "s", typeId: null, title: id, notes: "", deadlineAt: null, targetAt: null, completedAt: null,
  priority: null, sectionId: null, todayOn: null, sourceId: null, locallyModified: false, sortOrder: 0, createdAt: "",
  parts: [], ...extra,
});

describe("todayList", () => {
  it("holds what was picked for today and what is due today", () => {
    const list = todayList([
      task("picked", { todayOn: "2026-11-18" }),
      task("due", { deadlineAt: at(18, 17) }),
      task("tomorrow", { deadlineAt: at(19) }),
      task("yesterday", { todayOn: "2026-11-17" }),
      task("free"),
    ], now);
    expect(list.map((t) => t.id)).toEqual(["due", "picked"]);
  });

  it("keeps the ones ticked off, after the open ones", () => {
    const list = todayList([
      task("done", { todayOn: "2026-11-18", completedAt: at(18, 9) }),
      task("open", { todayOn: "2026-11-18" }),
    ], now);
    expect(list.map((t) => t.id)).toEqual(["open", "done"]);
  });
});

describe("leftOver", () => {
  it("is what was picked earlier and is still open", () => {
    const list = leftOver([
      task("old", { todayOn: "2026-11-16" }),
      task("old-done", { todayOn: "2026-11-17", completedAt: at(17, 20) }),
      task("today", { todayOn: "2026-11-18" }),
      task("old-but-due-today", { todayOn: "2026-11-17", deadlineAt: at(18) }),
    ], now);
    expect(list.map((t) => t.id)).toEqual(["old"]);
  });
});

describe("deadlines", () => {
  const tasks = [
    task("late", { deadlineAt: at(17) }),
    task("later-today", { deadlineAt: at(18, 17) }),
    task("in-a-week", { deadlineAt: at(25, 12) }),
    task("too-far", { deadlineAt: at(26, 12) }),
    task("late-done", { deadlineAt: at(16), completedAt: at(16, 10) }),
  ];

  it("past the deadline: open and late", () => {
    expect(pastDeadline(tasks, now).map((t) => t.id)).toEqual(["late"]);
  });

  it("upcoming: through the next seven days", () => {
    expect(upcoming(tasks, now).map((t) => t.id)).toEqual(["later-today", "in-a-week"]);
  });

  it("due soon: late ones first", () => {
    expect(dueSoon(tasks, now).map((t) => t.id)).toEqual(["late", "later-today", "in-a-week"]);
  });
});
