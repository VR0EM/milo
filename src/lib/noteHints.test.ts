import { describe, expect, it } from "vitest";
import { noteHints, type SpaceWords } from "./noteHints";

// Wednesday 18 November 2026.
const TODAY = new Date(2026, 10, 18, 9, 0);
const SPACES: SpaceWords[] = [
  { name: "Biology", words: ["biologie", "biology", "bio"] },
  { name: "Work", words: ["werk", "work", "shift"] },
];
const h = (note: string) => noteHints(note, TODAY, SPACES);

describe("days", () => {
  it.each([
    ["essay af tegen vrijdag", "2026-11-20"],
    ["call grandpa on friday", "2026-11-20"],
    ["iets doen woensdag", "2026-11-25"], // today's weekday means next week's
    ["bio toets volgende week maandag", "2026-11-23"],
    ["bio test next week wednesday", "2026-11-25"],
    ["morgen boodschappen", "2026-11-19"],
    ["overmorgen bellen", "2026-11-20"],
    ["vanavond strijken", "2026-11-18"],
    ["inleveren 2/12", "2026-12-02"],
    ["hand in on 2-12", "2026-12-02"],
    ["toets 8 december", "2026-12-08"],
    ["exam January 20", "2027-01-20"],
    ["verslag tegen za", "2026-11-21"],
    ["reading by sun", "2026-11-22"],
    ["vrijdagmiddag vrij", "2026-11-20"],
  ])("%s", (note, date) => expect(h(note).date).toBe(date));

  it("does not take short words or chapter ranges for days", () => {
    expect(h("do the dishes").date).toBeNull();
    expect(h("pagina 3-5 lezen").date).toBeNull();
    expect(h("sat down with the notes").date).toBeNull();
    expect(h("exercises 3.1-3.4").date).toBeNull();
    expect(h("oefeningen 1.2 - 1.6 tegen vrijdag").date).toBe("2026-11-20");
  });
});

describe("times", () => {
  it.each([
    ["bio 9u", "09:00"],
    ["tandarts 15u45", "15:45"],
    ["call at 4", "16:00"],
    ["om 11 vergadering", "11:00"],
    ["gym 7am", "07:00"],
    ["film 9pm", "21:00"],
    ["meeting 4:15pm", "16:15"],
    ["bus 06:50", "06:50"],
    ["werk van 9 tot 17u", "09:00"],
    ["shift 6-10pm", "18:00"],
    ["half 5 thee", "16:30"],
    ["indienen voor middernacht", "23:59"],
  ])("%s", (note, time) => expect(h(note).time).toBe(time));

  it("does not take numbers for times", () => {
    expect(h("oefeningen 4-8 maken").time).toBeNull();
    expect(h("hoofdstuk 12").time).toBeNull();
    expect(h("exercises 3.1-3.4").time).toBeNull();
  });
});

describe("spaces, steps and kind", () => {
  it("finds a space by its words, whole words only", () => {
    expect(h("bio samenvatting").space).toBe("Biology");
    expect(h("shift zaterdag").space).toBe("Work");
    expect(h("huiswerk maken").space).toBeNull(); // "werk" inside a word does not count
  });

  it("splits a list after a colon, without the deadline", () => {
    expect(h("poster: tekst, foto's en bronnen, tegen 2/12").parts).toEqual(["tekst", "foto's", "bronnen"]);
    expect(h("meeting om 9:30").parts).toBeNull();
  });

  it("knows a hand-in is a task and a time alone makes an event", () => {
    expect(h("essay inleveren vrijdag 17u").kind).toBe("task");
    expect(h("bio les vrijdag 10u").kind).toBe("event");
    expect(h("bio samenvatting").kind).toBeNull();
  });

  it("leaves the rest for a title", () => {
    expect(h("bio les vrijdag 10u").rest).toBe("bio les");
    expect(h("essay inleveren tegen 2/12").rest).toBe("essay inleveren");
  });
});
