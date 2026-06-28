import { describe, it, expect } from "vitest";
import { formatDate } from "./datetime";

describe("formatDate", () => {
  const d = new Date(2026, 5, 28, 9, 7, 5); // 2026-06-28 09:07:05 (月は0始まり)
  it("formats time HH:mm:ss with zero padding", () => {
    expect(formatDate("HH:mm:ss", d)).toBe("09:07:05");
  });
  it("formats date yyyy-MM-dd", () => {
    expect(formatDate("yyyy-MM-dd", d)).toBe("2026-06-28");
  });
  it("distinguishes MM(month) and mm(minute)", () => {
    expect(formatDate("MM/dd HH:mm", d)).toBe("06/28 09:07");
  });
});
