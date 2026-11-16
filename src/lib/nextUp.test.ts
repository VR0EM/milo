import { describe, expect, it } from "vitest";
import { fmtSpan, fmtUntil, pickNext } from "./nextUp";
import type { CalEvent, Space } from "./types";

const space = (id: string, role: Space["role"] = "normal"): Space => ({
  id, groupId: null, name: id, color: "blue", role, kind: "list", icon: null, sortOrder: 0, deletedAt: null,
});
const spaces = [space("school"), space("sleep", "sleep")];
const at = (h: number, m = 0) => new Date(2026, 10, 16, h, m);
const ev = (title: string, from: Date, to: Date, extra: Partial<CalEvent> = {}): CalEvent => ({
  id: title, spaceId: "school", activityId: null, title, startAt: from.toISOString(), endAt: to.toISOString(),
  allDay: false, notes: "", location: "", status: "planned", source: "milo", sourceId: null, locallyModified: false,
  taskId: null, seriesId: null, createdAt: "", updatedAt: "", deletedAt: null, ...extra,
} as CalEvent);

describe("pickNext", () => {
  const lesson = ev("Lesson", at(9), at(12));
  const lab = ev("Lab", at(12), at(14));

  it("shows the event running now", () => {
    expect(pickNext([lesson, lab], spaces, at(10))?.title).toBe("Lesson");
  });

  it("hands over to the next one a quarter of an hour before it starts", () => {
    expect(pickNext([lesson, lab], spaces, at(11, 50))?.title).toBe("Lab");
  });

  it("leaves out sleep, all-day, skipped and focus sessions", () => {
    const skip = [
      ev("Sleep", at(8), at(13), { spaceId: "sleep" }),
      ev("Holiday", at(0), at(23), { allDay: true }),
      ev("Cancelled", at(10), at(11), { status: "skipped" }),
      ev("Focus", at(10), at(11), { source: "focus" }),
    ];
    expect(pickNext([...skip, lab], spaces, at(10))?.title).toBe("Lab");
    expect(pickNext(skip, spaces, at(10))).toBeNull();
  });

  it("is empty once everything has ended", () => {
    expect(pickNext([lesson], spaces, at(12))).toBeNull();
  });
});

describe("fmtUntil", () => {
  it("counts down, then counts what is left", () => {
    const lab = ev("Lab", at(13), at(15));
    expect(fmtUntil(lab, at(12, 35))).toBe("in 25 min");
    expect(fmtUntil(lab, at(11, 50))).toBe("in 1 h 10");
    expect(fmtUntil(lab, new Date(at(13).getTime() - 30_000))).toBe("now");
    expect(fmtUntil(lab, at(14, 20))).toBe("40 min left");
    expect(fmtSpan(2 * 3_600_000)).toBe("2 h");
  });
});
