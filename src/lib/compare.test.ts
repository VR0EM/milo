import { describe, expect, it } from "vitest";
import { delta } from "./compare";

const min = (n: number) => `${Math.round(n)} min`;

describe("delta", () => {
  it("says more, less or the same, without a sign of good or bad", () => {
    expect(delta(130, 50, min)).toBe("+80 min");
    expect(delta(20, 55, min)).toBe("−35 min");
    expect(delta(40, 40.4, min)).toBe("same");
    expect(delta(40, undefined, min)).toBe("");
  });
});
