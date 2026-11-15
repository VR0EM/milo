import { describe, expect, it } from "vitest";
import {
  addDays,
  fmtDateField,
  fmtHm,
  fmtRange,
  fromDateInput,
  parseDate,
  parseTime,
  setClockPrefs,
  startOfWeek,
  toDateInput,
} from "./time";

// Sunday 15 November 2026, around noon.
const NOW = new Date(2026, 10, 15, 12, 0);

describe("parseDate: day first, whatever the computer's language", () => {
  it.each([
    ["19/11/2026", "2026-11-19"],
    ["19-11-26", "2026-11-19"],
    ["19.11.2026", "2026-11-19"],
    ["19.11", "2026-11-19"],
    ["19 11", "2026-11-19"],
    ["3/12", "2026-12-03"],
    ["19 nov", "2026-11-19"],
    ["19 November 2026", "2026-11-19"],
    ["nov 19", "2026-11-19"],
    ["2026-11-19", "2026-11-19"],
    ["Thu 19 Nov 2026", "2026-11-19"],
  ])("%s", (text, want) => expect(parseDate(text, NOW)).toBe(want));

  it("reads today, tomorrow, yesterday and weekdays", () => {
    expect(parseDate("today", NOW)).toBe("2026-11-15");
    expect(parseDate("Tomorrow", NOW)).toBe("2026-11-16");
    expect(parseDate("yesterday", NOW)).toBe("2026-11-14");
    expect(parseDate("fri", NOW)).toBe("2026-11-20");
    expect(parseDate("friday", NOW)).toBe("2026-11-20");
    // A weekday means the next one, never today.
    expect(parseDate("sun", NOW)).toBe("2026-11-22");
  });

  it("puts a date without a year in the coming months", () => {
    expect(parseDate("5/1", NOW)).toBe("2027-01-05");
    // Last month is still this year: a deadline that just passed.
    expect(parseDate("20/10", NOW)).toBe("2026-10-20");
  });

  it("refuses what is not a date", () => {
    for (const bad of ["", "abc", "31/2", "32/1", "13/13", "19 xyz", "fr"]) expect(parseDate(bad, NOW)).toBeNull();
  });

  it("gives back what the field shows", () => {
    const v = "2026-02-28";
    expect(parseDate(fmtDateField(fromDateInput(v)), NOW)).toBe(v);
  });
});

describe("fmtDateField", () => {
  it("writes the date out with the weekday", () => {
    expect(fmtDateField(new Date(2026, 10, 19))).toBe("Thu 19 Nov 2026");
  });
});

describe("parseTime", () => {
  it.each([
    ["9", "09:00"],
    ["930", "09:30"],
    ["9:30", "09:30"],
    ["09.30", "09:30"],
    ["9h30", "09:30"],
    ["2pm", "14:00"],
    ["2:30 pm", "14:30"],
    ["12am", "00:00"],
  ])("%s", (text, want) => expect(parseTime(text)).toBe(want));

  it("refuses impossible times", () => {
    for (const bad of ["24:00", "9:60", "13pm", "abc"]) expect(parseTime(bad)).toBeNull();
  });
});

describe("clock preferences", () => {
  it("shows am/pm when chosen", () => {
    setClockPrefs({ weekStart: 1, timeFormat: "12h" });
    expect(fmtHm("14:05")).toBe("2:05 pm");
    expect(fmtHm("00:30")).toBe("12:30 am");
    expect(fmtRange(new Date(2026, 0, 1, 9), new Date(2026, 0, 1, 10, 30))).toBe("9:00 – 10:30 am");
    setClockPrefs({ weekStart: 1, timeFormat: "24h" });
    expect(fmtHm("14:05")).toBe("14:05");
  });

  it("starts the week on Monday or Sunday", () => {
    setClockPrefs({ weekStart: 1, timeFormat: "24h" });
    expect(toDateInput(startOfWeek(NOW))).toBe("2026-11-09");
    setClockPrefs({ weekStart: 0, timeFormat: "24h" });
    expect(toDateInput(startOfWeek(NOW))).toBe("2026-11-15");
    setClockPrefs({ weekStart: 1, timeFormat: "24h" });
  });
});

describe("addDays", () => {
  it("keeps the clock time over the change to winter time", () => {
    // Summer time ends in Belgium on Sunday 25 October 2026.
    const d = addDays(new Date(2026, 9, 24, 9, 0), 2);
    expect([d.getDate(), d.getHours()]).toEqual([26, 9]);
  });
});
