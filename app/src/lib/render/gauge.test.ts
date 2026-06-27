import { describe, it, expect } from "vitest";
import { valueToFraction, valueToAngle } from "./gauge";

describe("valueToFraction", () => {
  it("maps value within range to 0..1 and clamps", () => {
    expect(valueToFraction(50, 0, 100)).toBe(0.5);
    expect(valueToFraction(-10, 0, 100)).toBe(0);
    expect(valueToFraction(150, 0, 100)).toBe(1);
  });
  it("handles zero-width range without NaN", () => {
    expect(valueToFraction(5, 10, 10)).toBe(0);
  });
});

describe("valueToAngle", () => {
  it("interpolates between start and end angle", () => {
    expect(valueToAngle(0, 0, 100, -120, 120)).toBe(-120);
    expect(valueToAngle(100, 0, 100, -120, 120)).toBe(120);
    expect(valueToAngle(50, 0, 100, -120, 120)).toBe(0);
  });
});
