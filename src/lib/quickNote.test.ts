import { describe, expect, it } from "vitest";
import { looksLikeAppointment, parseNote } from "./quickNote";
import type { Task } from "./types";

const now = new Date(2026, 10, 18, 9, 0); // Wednesday 18 November
const local = (iso: string | null) => (iso ? new Date(iso).toString().slice(0, 21) : null);

describe("parseNote", () => {
  it("takes the day and time out of the title", () => {
    const n = parseNote("labo chemie inleveren vrijdag 23u", now);
    expect(n.title).toBe("labo chemie inleveren");
    expect(local(n.deadlineAt)).toBe("Fri Nov 20 2026 23:00");
  });

  it("a day without a time is the end of that day", () => {
    expect(local(parseNote("boodschappen doen overmorgen", now).deadlineAt)).toBe("Fri Nov 20 2026 23:59");
  });

  it("a list after a colon becomes steps", () => {
    const n = parseNote("verslag afwerken: inleiding, code, conclusie, tegen 27/11", now);
    expect(n).toMatchObject({ title: "verslag afwerken", steps: ["inleiding", "code", "conclusie"] });
    expect(local(n.deadlineAt)).toBe("Fri Nov 27 2026 23:59");
  });

  it("leaves a note without a day as it is", () => {
    expect(parseNote("mama bellen", now)).toEqual({ title: "mama bellen", deadlineAt: null, steps: [] });
    expect(parseNote("etentje met Jan en Els", now).steps).toEqual([]);
  });
});

describe("looksLikeAppointment", () => {
  const task = (title: string, deadlineAt: string | null): Task => ({
    id: "t", spaceId: "s", typeId: null, title, notes: "", deadlineAt, targetAt: null, completedAt: null, priority: null,
    sectionId: null, todayOn: null, sourceId: null, locallyModified: false, sortOrder: 0, createdAt: "", parts: [],
  });
  const at = (h: number, m = 0) => new Date(2026, 10, 24, h, m).toISOString();

  it("a set time without a deadline word", () => {
    expect(looksLikeAppointment(task("tandarts", at(14, 30)))).toBe(true);
    expect(looksLikeAppointment(task("labo chemie inleveren", at(23)))).toBe(false);
    expect(looksLikeAppointment(task("report due", at(17)))).toBe(false);
    expect(looksLikeAppointment(task("boodschappen", at(23, 59)))).toBe(false);
    expect(looksLikeAppointment(task("mama bellen", null))).toBe(false);
  });
});
