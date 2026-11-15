import { describe, expect, it } from "vitest";
import { pickDefaultSpace } from "./spaces";
import type { Space } from "./types";

const space = (id: string, extra: Partial<Space> = {}): Space => ({
  id, groupId: null, name: id, color: "blue", role: "normal", icon: null, sortOrder: 0, deletedAt: null, ...extra,
});

describe("pickDefaultSpace", () => {
  const chem = space("chem", { groupId: "school" });
  const personal = space("seed-space-personal");
  const sleep = space("sleep");

  it("takes the one asked for", () => {
    expect(pickDefaultSpace([chem, personal, sleep], "sleep")?.id).toBe("sleep");
  });

  it("falls back to Personal, not to whatever is first", () => {
    expect(pickDefaultSpace([chem, sleep, personal], null)?.id).toBe("seed-space-personal");
    expect(pickDefaultSpace([chem, sleep, personal], "gone")?.id).toBe("seed-space-personal");
  });

  it("then a space outside a group, then any", () => {
    expect(pickDefaultSpace([chem, sleep])?.id).toBe("sleep");
    expect(pickDefaultSpace([chem])?.id).toBe("chem");
  });

  it("never picks an archived space", () => {
    const old = space("old", { deletedAt: "2026-01-01T00:00:00Z" });
    expect(pickDefaultSpace([old, chem], "old")?.id).toBe("chem");
    expect(pickDefaultSpace([old])).toBeUndefined();
  });
});
