import { describe, expect, it } from "vitest";
import { SystemOne, features, normalize, sameThing } from "./systemOne";

describe("features", () => {
  it("drops accents, filler words and bare numbers", () => {
    expect(normalize("Café  één!")).toBe("cafe een");
    expect(features("de les van 10").filter((f) => f.startsWith("w:"))).toEqual(["w:les"]);
  });

  it("shares pieces between Dutch and English words", () => {
    const fysica = new Set(features("fysica"));
    expect(features("physics").some((f) => fysica.has(f))).toBe(true);
  });
});

describe("SystemOne", () => {
  const history = [
    { text: "Chemistry", label: "Chemistry", weight: 3 },
    { text: "Work", label: "Work", weight: 3 },
    { text: "labo chemie verslag", label: "Chemistry" },
    { text: "titratie oefeningen", label: "Chemistry" },
    { text: "shift zaterdag", label: "Work" },
    { text: "rooster doorsturen naar baas", label: "Work" },
  ];

  it("learns from her own notes", () => {
    const m = new SystemOne(history);
    expect(m.decide("chemie samenvatting").label).toBe("Chemistry");
    expect(m.decide("shift maandag").label).toBe("Work");
  });

  it("says why", () => {
    expect(new SystemOne(history).decide("titratie labo").why).toContain("titratie");
  });

  it("is not sure about words it never saw", () => {
    const d = new SystemOne(history).decide("zzz qqq");
    expect(d.label).toBeNull();
  });

  it("only answers among the allowed choices", () => {
    expect(new SystemOne(history).decide("shift", ["Chemistry"]).ranked.map((r) => r.label)).toEqual(["Chemistry"]);
  });

  it("gets better with a correction", () => {
    const m = new SystemOne(history);
    m.learn({ text: "optiek labo", label: "Physics" });
    m.learn({ text: "optiek oefeningen", label: "Physics" });
    expect(m.decide("optiek").label).toBe("Physics");
  });
});

describe("sameThing", () => {
  it("finds the same to-do written twice, and only that", () => {
    expect(sameThing("matrices oefenen", "Matrices oefenen!")).toBe(true);
    expect(sameThing("boodschappen", "boodschappen doen")).toBe(true);
    expect(sameThing("pick up package", "pick up the package at post office")).toBe(true);
    expect(sameThing("labo chemie verslag", "labo fysica verslag")).toBe(false);
    expect(sameThing("hoofdstuk 4 lezen", "hoofdstuk 5 lezen")).toBe(false);
    expect(sameThing("labo", "labo chemie verslag")).toBe(false);
  });
});
