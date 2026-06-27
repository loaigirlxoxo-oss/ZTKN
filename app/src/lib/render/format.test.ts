import { describe, it, expect } from "vitest";
import { formatValue, splitFormat } from "./format";

describe("splitFormat", () => {
  it("splits value and unit suffix", () => {
    expect(splitFormat("%d °C")).toEqual({ prefix: "", token: "%d", suffix: " °C" });
  });
  it("splits prefix, token and suffix", () => {
    expect(splitFormat("CPU %.1f%")).toEqual({ prefix: "CPU ", token: "%.1f", suffix: "%" });
  });
  it("returns null for a literal without token", () => {
    expect(splitFormat("Label")).toBeNull();
  });
});

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
