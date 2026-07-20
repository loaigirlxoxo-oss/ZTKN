import { describe, it, expect } from "vitest";
import { isCountdownFormat, humanizeRemaining, formatCountdown } from "./format";

describe("countdown format（%t = リセットまでの残り時間）", () => {
  it("isCountdownFormat は %t を検出", () => {
    expect(isCountdownFormat("残り %t")).toBe(true);
    expect(isCountdownFormat("%d")).toBe(false);
    expect(isCountdownFormat(undefined)).toBe(false);
  });

  it("humanizeRemaining は桁で表記を変える", () => {
    expect(humanizeRemaining(5 * 86400_000 + 21 * 3600_000 + 30 * 60_000)).toBe("5d 21h");
    expect(humanizeRemaining(2 * 3600_000 + 13 * 60_000 + 5000)).toBe("2h 13m");
    expect(humanizeRemaining(13 * 60_000 + 5000)).toBe("13m");
    expect(humanizeRemaining(42_000)).toBe("42s");
    expect(humanizeRemaining(0)).toBe("0m");
    expect(humanizeRemaining(-5000)).toBe("0m");
  });

  it("formatCountdown は %t を残りへ置換、無効値は — ", () => {
    const target = Date.now() + (2 * 3600_000 + 13 * 60_000 + 30_000);
    expect(formatCountdown("残り %t", target)).toBe("残り 2h 13m");
    expect(formatCountdown("%t", 0)).toBe("—");
    expect(formatCountdown("%t", NaN)).toBe("—");
  });
});
