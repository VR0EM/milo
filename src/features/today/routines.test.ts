import { describe, expect, it } from "vitest";
import type { CalEvent, Routine } from "../../lib/types";
import { activeRoutine } from "./routines";

const day = (h: number, m = 0) => new Date(2026, 10, 18, h, m); // Wednesday
const routine = (extra: Partial<Routine>): Routine => ({
  id: "r", name: "Morning", spaceId: null, startTime: "07:00", endTime: "10:00", weekdays: "1234567", sortOrder: 0, items: [], ...extra,
});
const event = (spaceId: string, from: Date, to: Date, extra: Partial<CalEvent> = {}): CalEvent => ({
  id: "e", spaceId, activityId: null, title: "Morning routine", startAt: from.toISOString(), endAt: to.toISOString(), allDay: false,
  notes: "", location: "", reminders: null, status: "planned", source: "manual", sourceId: null, locallyModified: false,
  taskId: null, seriesId: null, createdAt: "", updatedAt: "", deletedAt: null, ...extra,
});

describe("activeRoutine", () => {
  it("follows the events of its space, from half an hour before", () => {
    const r = routine({ spaceId: "morning" });
    const events = [event("morning", day(7, 30), day(8, 15))];
    expect(activeRoutine([r], day(6, 50), events)).toBeNull();
    expect(activeRoutine([r], day(7, 5), events)?.until).toEqual(day(8, 15));
    expect(activeRoutine([r], day(8, 0), events)?.day).toBe("2026-11-18");
    expect(activeRoutine([r], day(8, 15), events)).toBeNull();
    // Not at its old set times when there is no event.
    expect(activeRoutine([r], day(9, 0), [])).toBeNull();
  });

  it("leaves out an event that did not happen", () => {
    const r = routine({ spaceId: "morning" });
    expect(activeRoutine([r], day(8, 0), [event("morning", day(7, 30), day(8, 15), { status: "skipped" })])).toBeNull();
  });

  it("keeps set times for a routine without a space", () => {
    expect(activeRoutine([routine({})], day(9, 0))?.until).toEqual(day(10, 0));
    expect(activeRoutine([routine({})], day(11, 0))).toBeNull();
  });
});
