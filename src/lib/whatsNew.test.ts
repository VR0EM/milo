import { describe, expect, it } from "vitest";
import pkg from "../../package.json";
import { RELEASES, compareVersions, unseenReleases } from "./whatsNew";

describe("compareVersions", () => {
  it("compares numbers, not text", () => {
    expect(compareVersions("0.3.10", "0.3.9")).toBe(1);
    expect(compareVersions("0.3.4", "0.3.4")).toBe(0);
    expect(compareVersions("0.3.4", "1.0.0")).toBe(-1);
  });
});

describe("unseenReleases", () => {
  it("lists what came after the version that was read, up to this one", () => {
    expect(unseenReleases("0.3.3", "0.3.5").map((r) => r.version)).toEqual(["0.3.5", "0.3.4"]);
    expect(unseenReleases("0.3.5", "0.3.5")).toEqual([]);
    // Notes written for a version that is not out yet stay hidden.
    expect(unseenReleases("0.3.4", "0.3.4")).toEqual([]);
  });
});

describe("the notes themselves", () => {
  it("are newest first, with each version once", () => {
    const versions = RELEASES.map((r) => r.version);
    expect(new Set(versions).size).toBe(versions.length);
    for (let i = 1; i < versions.length; i++) expect(compareVersions(versions[i - 1], versions[i])).toBe(1);
  });

  it("tell what this version brings", () => {
    const entry = RELEASES.find((r) => r.version === pkg.version);
    expect(entry, `src/lib/whatsNew.ts has no notes for ${pkg.version}`).toBeDefined();
    expect(entry!.items.length).toBeGreaterThan(0);
  });

  it("have real dates and no empty lines", () => {
    for (const r of RELEASES) {
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      for (const item of r.items) expect(item.trim()).not.toBe("");
    }
  });
});
