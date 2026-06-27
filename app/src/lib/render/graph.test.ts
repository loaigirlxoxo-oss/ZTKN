import { describe, it, expect } from "vitest";
import { historyToPoints } from "./graph";

describe("historyToPoints", () => {
  it("returns empty for fewer than 2 points", () => {
    expect(historyToPoints([], 100, 50)).toEqual([]);
    expect(historyToPoints([5], 100, 50)).toEqual([]);
  });
  it("auto-scales to history min/max", () => {
    expect(historyToPoints([0, 10], 100, 50)).toEqual([0, 50, 100, 0]);
  });
  it("uses fixed range when provided", () => {
    expect(historyToPoints([50, 50], 100, 50, [0, 100])).toEqual([0, 25, 100, 25]);
  });
  it("clamps values outside the range", () => {
    expect(historyToPoints([-50, 150], 100, 100, [0, 100])).toEqual([0, 100, 100, 0]);
  });
  it("does not divide by zero on flat history", () => {
    const pts = historyToPoints([7, 7, 7], 100, 40);
    expect(pts).toHaveLength(6);
    expect(pts.every((n) => Number.isFinite(n))).toBe(true);
  });
});
