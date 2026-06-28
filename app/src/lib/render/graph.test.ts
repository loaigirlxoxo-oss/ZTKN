import { describe, it, expect } from "vitest";
import { historyToPoints, graphScale, niceScale, autoRateUnit } from "./graph";

describe("autoRateUnit", () => {
  it("keeps the unit when the value is already readable", () => {
    expect(autoRateUnit("Mbps", 600)).toEqual({ unit: "Mbps", factor: 1 });
  });
  it("steps down to Kbps for small values", () => {
    expect(autoRateUnit("Mbps", 0.4)).toEqual({ unit: "Kbps", factor: 1000 });
  });
  it("steps up to Gbps for large values", () => {
    expect(autoRateUnit("Mbps", 5000)).toEqual({ unit: "Gbps", factor: 0.001 });
  });
  it("passes through non-rate units", () => {
    expect(autoRateUnit("°C", 50)).toEqual({ unit: "°C", factor: 1 });
  });
});

describe("niceScale", () => {
  it("rounds bounds to nice numbers with a step", () => {
    expect(niceScale(0, 9)).toEqual({ min: 0, max: 10, step: 2 });
  });
  it("handles equal min/max without zero span", () => {
    const s = niceScale(5, 5);
    expect(s.max).toBeGreaterThan(s.min);
  });
});

describe("graphScale", () => {
  it("returns the fixed range when provided", () => {
    expect(graphScale([1, 2, 3], [0, 100])).toEqual([0, 100]);
  });
  it("auto-scales non-negative data from 0 to a nice max", () => {
    expect(graphScale([3, 9, 5])).toEqual([0, 10]);
  });
  it("widens a flat history to a nice 0-based range", () => {
    expect(graphScale([7, 7])).toEqual([0, 8]);
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
