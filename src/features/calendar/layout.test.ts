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

  it("gives a very short event the room it is drawn with, as far as the next event", () => {
    // A one-minute focus at 22:00 is drawn about 25 minutes tall when nothing follows.
    const alone = layoutDay([ev("focus", at(22), at(22, 1))], day, 25);
    expect(alone[0].drawnBottom).toBe(22 * 60 + 25);
    // An event from 22:10 is not pushed aside: the focus is drawn up to it, and both use the width.
    const items = [ev("focus", at(22), at(22, 1)), ev("next", at(22, 10), at(23))];
    const segs = layoutDay(items, day, 25);
    expect(segs.map((s) => [s.col, s.cols, s.level])).toEqual([[0, 1, 0], [0, 1, 0]]);
    expect(segs[0].drawnBottom).toBe(22 * 60 + 10);
  });

  it("keeps quarter-hour events back to back in one column when zoomed out", () => {
    // Zoomed out, the shortest drawn height (22 px) is more than a quarter of an hour.
    const items = [0, 15, 30, 45].map((m) => ev(`r${m}`, at(9, m), at(9, m + 15)));
    const segs = layoutDay(items, day, 40, 80);
    expect(segs.map((s) => [s.level, s.col, s.cols])).toEqual([[0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1]]);
    expect(segs.map((s) => s.drawnBottom - s.top)).toEqual([15, 15, 15, 40]) // nothing follows the last one;
  });

  it("keeps a short routine above the sleep that starts when it ends", () => {
    const items = [ev("night", at(22, 15), at(22, 30)), ev("sleep", at(22, 30), at(23, 59))];
    expect(layoutDay(items, day, 40, 80).map((s) => [s.item.id, s.level, s.cols])).toEqual([["night", 0, 1], ["sleep", 0, 1]]);
  });
});

describe("layoutDay, like Notion", () => {
  const lay = (items: ReturnType<typeof ev>[], min = 22) =>
    Object.fromEntries(layoutDay(items, day, min).map((s) => [s.item.id, [s.level, s.col, s.cols]]));

  it("draws a later event on top of a running one, one level in", () => {
    expect(lay([ev("cloud", at(9), at(10)), ev("cloud2", at(9, 45), at(11, 45))])).toEqual({ cloud: [0, 0, 1], cloud2: [1, 0, 1] });
  });

  it("puts events that start together side by side", () => {
    expect(lay([ev("lunch", at(13, 15), at(14)), ev("lunch2", at(13, 15), at(14))])).toEqual({ lunch: [0, 0, 2], lunch2: [0, 1, 2] });
    // Ten minutes apart would cover the first title at this zoom: side by side too.
    expect(lay([ev("a", at(21), at(21, 30)), ev("b", at(21, 10), at(21, 30))])).toEqual({ a: [0, 0, 2], b: [0, 1, 2] });
  });

  it("keeps the title of the one underneath in view", () => {
    // With 50 minutes of room for a title and its time, a half-hour-later start goes beside it.
    const items = [ev("tutorial", at(10), at(12)), ev("exercises", at(10, 30), at(12))];
    expect(Object.fromEntries(layoutDay(items, day, 25, 50).map((s) => [s.item.id, [s.level, s.col, s.cols]])))
      .toEqual({ tutorial: [0, 0, 2], exercises: [0, 1, 2] });
  });

  it("nests short events inside a long one, each at the first free level", () => {
    const items = [ev("exam", at(14), at(16)), ev("coffee", at(14, 45), at(15)), ev("coffee2", at(15, 30), at(16, 45))];
    expect(lay(items)).toEqual({ exam: [0, 0, 1], coffee: [1, 0, 1], coffee2: [1, 0, 1] });
  });

  it("goes a level deeper for each event still running", () => {
    const items = [ev("a", at(9), at(12)), ev("b", at(9, 30), at(12)), ev("c", at(10), at(11))];
    expect(lay(items)).toEqual({ a: [0, 0, 1], b: [1, 0, 1], c: [2, 0, 1] });
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
