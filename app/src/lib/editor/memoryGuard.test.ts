import { describe, it, expect } from "vitest";
import { decodeResetState, mustWaitForIdle } from "./resetState";

const panel = { size: { x: 0, y: 0, w: 1920, h: 520 }, items: [{ id: "a" }] };

describe("decodeResetState", () => {
  it("表示状態・パネル・倍率を読み解く", () => {
    const s = decodeResetState(JSON.stringify({ present: true, panel, zoom: 0.5 }));
    expect(s?.present).toBe(true);
    expect(s?.panel.size.w).toBe(1920);
    expect(s?.panel.items).toHaveLength(1);
    expect(s?.zoom).toBe(0.5);
  });

  it("保存が無ければ null", () => {
    expect(decodeResetState(null)).toBeNull();
    expect(decodeResetState("")).toBeNull();
  });

  it("壊れた・形が違う保存は null（起動を止めない）", () => {
    expect(decodeResetState("{壊れている")).toBeNull();
    expect(decodeResetState(JSON.stringify({ present: "yes", panel, zoom: 1 }))).toBeNull();
    expect(decodeResetState(JSON.stringify({ present: true, panel: { items: [] }, zoom: 1 }))).toBeNull();
    expect(decodeResetState(JSON.stringify({ present: true, zoom: 1 }))).toBeNull();
  });
});

describe("mustWaitForIdle", () => {
  it("編集画面では、最後の操作から1分たつまで待つ", () => {
    expect(mustWaitForIdle(false, 10_000, 60_000)).toBe(true);
    expect(mustWaitForIdle(false, 60_000, 60_000)).toBe(false);
  });
  it("表示専用画面では、操作の直後でも待たない", () => {
    expect(mustWaitForIdle(true, 0, 60_000)).toBe(false);
  });
});
