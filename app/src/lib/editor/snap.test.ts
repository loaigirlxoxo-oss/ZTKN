import { describe, it, expect } from "vitest";
import { snap } from "./snap";

describe("snap", () => {
  it("snaps to nearest grid step", () => {
    expect(snap(23, 10)).toBe(20);
    expect(snap(26, 10)).toBe(30);
  });
  it("returns value unchanged when grid<=1", () => {
    expect(snap(23, 1)).toBe(23);
    expect(snap(23, 0)).toBe(23);
  });
});
