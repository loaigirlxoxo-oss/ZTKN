import { describe, it, expect } from "vitest";
import { blockStartX } from "./textAlign";

describe("blockStartX（箱内の整列＝コンテナ幅固定で左/中央/右に配置）", () => {
  const cw = 200;
  const bw = 60;

  it("左/中央/右で異なる位置になる＝整列が実際に効く", () => {
    const left = blockStartX(cw, bw, "left");
    const center = blockStartX(cw, bw, "center");
    const right = blockStartX(cw, bw, "right");
    expect(left).toBe(0);
    expect(center).toBe(70); // (200-60)/2
    expect(right).toBe(140); // 200-60
    // 3つが全て別位置であること（＝ボタンを押すと動く）
    expect(new Set([left, center, right]).size).toBe(3);
  });

  it("桁が増えて block が広がっても、右揃えは右端基準で移動する（左端固定にならない）", () => {
    expect(blockStartX(cw, 60, "right")).toBe(140);
    expect(blockStartX(cw, 90, "right")).toBe(110); // block広→開始Xは左へ寄る＝右端は固定
  });

  it("block が箱より広い場合は 0 にクランプ", () => {
    expect(blockStartX(50, 80, "right")).toBe(0);
    expect(blockStartX(50, 80, "center")).toBe(0);
  });
});
