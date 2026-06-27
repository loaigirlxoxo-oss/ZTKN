import { describe, it, expect } from "vitest";
import { formatValue } from "./format";

describe("formatValue", () => {
  it("%d rounds to integer", () => {
    expect(formatValue("%d", 74.6)).toBe("75");
  });
  it("%.1f keeps one decimal", () => {
    expect(formatValue("%.1f", 3.14159)).toBe("3.1");
  });
  it("embeds value within surrounding text", () => {
    expect(formatValue("%d °C", 75.2)).toBe("75 °C");
  });
  it("returns the literal text when no token", () => {
    expect(formatValue("CPU", 99)).toBe("CPU");
  });
  it("shows -- for non-finite value", () => {
    expect(formatValue("%d °C", NaN)).toBe("-- °C");
  });
});
