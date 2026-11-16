import { describe, expect, it } from "vitest";
import { addDays } from "../../lib/time";
import type { CalEvent } from "../../lib/types";
import { lanesPerColumn, layoutSpans } from "./spans";

const monday = new Date(2026, 10, 16);
const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i));

/** An all-day event from day `from` for `days` days, counted from that Monday. */
const allDay = (title: string, from: number, days: number): CalEvent => ({
  id: title, spaceId: "s", activityId: null, title,
  startAt: addDays(monday, from).toISOString(), endAt: addDays(monday, from + days).toISOString(),
  allDay: true, notes: "", location: "", reminders: null, status: "planned", source: "milo", sourceId: null, locallyModified: false,
  taskId: null, seriesId: null, createdAt: "", updatedAt: "", deletedAt: null,
});

describe("layoutSpans", () => {
  it("draws a multi-day event as one bar over its days", () => {
    const [s] = layoutSpans([allDay("Trip", 1, 3)], week);
    expect([s.from, s.to, s.lane, s.cutStart, s.cutEnd]).toEqual([1, 3, 0, false, false]);
  });

  it("puts overlapping bars on separate lines, the longest on top", () => {
    const spans = layoutSpans([allDay("Short", 2, 1), allDay("Long", 0, 5)], week);
    const lane = Object.fromEntries(spans.map((s) => [s.event.title, s.lane]));
    expect(lane).toEqual({ Long: 0, Short: 1 });
    expect(lanesPerColumn(spans, 7)).toEqual([1, 1, 2, 1, 1, 0, 0]);
  });

  it("reuses a line once the bar above has ended", () => {
    const spans = layoutSpans([allDay("A", 0, 2), allDay("B", 3, 2)], week);
    expect(spans.map((s) => s.lane)).toEqual([0, 0]);
  });

  it("marks bars that run on past the week", () => {
    const [s] = layoutSpans([allDay("Holiday", -2, 4)], week);
    expect([s.from, s.to, s.cutStart, s.cutEnd]).toEqual([0, 1, true, false]);
  });

  it("leaves out timed events and events outside the week", () => {
    const timed = { ...allDay("Lesson", 1, 1), allDay: false };
    expect(layoutSpans([timed, allDay("Later", 9, 1)], week)).toEqual([]);
  });
});
