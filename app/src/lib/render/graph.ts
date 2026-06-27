// 履歴値の配列を、幅w・高さhの箱に収まる折れ線の points([x0,y0,x1,y1,...]) へ変換する。
// range 指定があれば固定スケール、無ければ履歴の min/max に自動スケールする（ネットワーク速度向け）。
export function historyToPoints(history: number[], w: number, h: number, range?: [number, number]): number[] {
  if (history.length < 2) return [];
  let min: number, max: number;
  if (range) {
    [min, max] = range;
  } else {
    min = Math.min(...history);
    max = Math.max(...history);
  }
  if (max === min) { min -= 1; max += 1; } // 平坦でも0除算しない
  const n = history.length;
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * w;
    let f = (history[i] - min) / (max - min);
    f = Math.max(0, Math.min(1, f));
    pts.push(x, h - f * h); // 上が大きい値
  }
  return pts;
}
