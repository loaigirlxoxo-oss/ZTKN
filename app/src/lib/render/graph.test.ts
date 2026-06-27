import { describe, it, expect } from "vitest";
import { historyToPoints, graphScale } from "./graph";

describe("graphScale", () => {
  it("returns the fixed range when provided", () => {
    expect(graphScale([1, 2, 3], [0, 100])).toEqual([0, 100]);
  });
  it("auto-scales to history min/max", () => {
    expect(graphScale([3, 9, 5])).toEqual([3, 9]);
  });
  it("widens a flat history to avoid zero span", () => {
    expect(graphScale([7, 7])).toEqual([6, 8]);
  });
  it("falls back to [0,1] for empty history", () => {
    expect(graphScale([])).toEqual([0, 1]);
  });
});

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
