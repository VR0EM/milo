import { describe, expect, it } from "vitest";
import { layoutDay, turnOver } from "./layout";

const day = new Date(2026, 10, 16);
const at = (h: number, m = 0) => new Date(2026, 10, 16, h, m);
const ev = (id: string, a: Date, b: Date) => ({ id, start: a, end: b });

describe("layoutDay", () => {
  it("puts events that meet end to end in one column", () => {
    const segs = layoutDay([ev("a", at(9), at(10)), ev("b", at(10), at(11))], day);
    expect(segs.map((s) => [s.item.id, s.col, s.cols])).toEqual([["a", 0, 1], ["b", 0, 1]]);
  });

  it("gives a very short event the room it is drawn with", () => {
    // A one-minute focus at 22:00 is drawn about half an hour tall; an event from 22:10
    // would be hidden under it, so it goes beside it.
    const items = [ev("focus", at(22), at(22, 1)), ev("next", at(22, 10), at(23))];
    expect(layoutDay(items, day).map((s) => s.cols)).toEqual([1, 1]);
    expect(layoutDay(items, day, 25).map((s) => [s.col, s.cols])).toEqual([[0, 2], [1, 2]]);
    // Once the drawn room has passed, the next event uses the whole width again.
    const later = [ev("focus", at(22), at(22, 1)), ev("after", at(22, 30), at(23))];
    expect(layoutDay(later, day, 25).map((s) => s.cols)).toEqual([1, 1]);
  });
});

describe("turnOver", () => {
  const q = 15 * 60_000;
  const t = (h: number, m = 0) => at(h, m).getTime();

  it("pulls the end later, or above the start to turn the event over", () => {
    expect(turnOver(t(18), t(20, 45), "end", q)).toEqual([t(18), t(20, 45)]);
    expect(turnOver(t(18), t(15, 15), "end", q)).toEqual([t(15, 15), t(18)]);
  });

  it("pulls the start earlier, or below the end to turn the event over", () => {
    expect(turnOver(t(18), t(15, 15), "start", q)).toEqual([t(15, 15), t(18)]);
    expect(turnOver(t(18), t(20), "start", q)).toEqual([t(18), t(20)]);
  });

  it("keeps the shortest length right on the fixed edge", () => {
    expect(turnOver(t(18), t(18), "end", q)).toEqual([t(18), t(18, 15)]);
    expect(turnOver(t(18), t(18), "start", q)).toEqual([t(17, 45), t(18)]);
  });
});
