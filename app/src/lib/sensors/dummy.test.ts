import { describe, it, expect } from "vitest";
import { dummyValue, DUMMY_SENSORS } from "./dummy";

describe("dummyValue", () => {
  it("returns a value within the sensor's declared range", () => {
    for (const s of DUMMY_SENSORS) {
      const v = dummyValue(s.id, 1000);
      expect(v).toBeGreaterThanOrEqual(s.min);
      expect(v).toBeLessThanOrEqual(s.max);
    }
  });
  it("is deterministic for the same id and time", () => {
    expect(dummyValue("TCPU", 1234)).toBe(dummyValue("TCPU", 1234));
  });
  it("returns NaN for unknown sensor id", () => {
    expect(Number.isNaN(dummyValue("NOPE", 0))).toBe(true);
  });
});
