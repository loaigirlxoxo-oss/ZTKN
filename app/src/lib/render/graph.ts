// キリの良い数（1,2,5×10^n）に丸める（Heckbert の nice number）。
function niceNum(x: number, round: boolean): number {
  if (x <= 0) return 1;
  const exp = Math.floor(Math.log10(x));
  const f = x / Math.pow(10, exp);
  let nf: number;
  if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
  else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * Math.pow(10, exp);
}

// [min,max] をキリの良い境界に広げ、目盛り間隔 step とともに返す（約 maxTicks 本）。
export function niceScale(min: number, max: number, maxTicks = 4): { min: number; max: number; step: number } {
  if (max === min) max = min + 1;
  const range = niceNum(max - min, false);
  const step = niceNum(range / maxTicks, true);
  return { min: Math.floor(min / step) * step, max: Math.ceil(max / step) * step, step };
}

// データレート単位の桁ラダー（各 ×1000）。
const RATE_LADDER = ["bps", "Kbps", "Mbps", "Gbps", "Tbps"];

// 基準単位 baseUnit と代表値 ref（=スケール上限）から、読みやすい表示単位と
// 変換係数を返す。レート系以外は素通し。例: ("Mbps", 0.4) → {unit:"Kbps", factor:1000}
export function autoRateUnit(baseUnit: string, ref: number): { unit: string; factor: number } {
  const idx = RATE_LADDER.indexOf(baseUnit);
  if (idx < 0 || !Number.isFinite(ref) || ref <= 0) return { unit: baseUnit, factor: 1 };
  let i = idx;
  let v = ref;
  while (v >= 1000 && i < RATE_LADDER.length - 1) { v /= 1000; i++; }
  while (v < 1 && i > 0) { v *= 1000; i--; }
  return { unit: RATE_LADDER[i], factor: Math.pow(1000, idx - i) };
}

// 現在のスケール（[min,max]）を返す。range 指定があれば固定、無ければ自動。
// 自動時は非負データを 0 基準にし、上限をキリの良い数へ丸める（絶対量が読め、数値が暴れない）。
export function graphScale(history: number[], range?: [number, number]): [number, number] {
  if (range) return range;
  if (history.length === 0) return [0, 1];
  let lo = Math.min(...history);
  const hi = Math.max(...history);
  if (lo >= 0) lo = 0; // 非負データは0基準
  const s = niceScale(lo, hi);
  return [s.min, s.max];
}

// 履歴値の配列を、幅w・高さhの箱に収まる折れ線の points([x0,y0,x1,y1,...]) へ変換する。
// range 指定があれば固定スケール、無ければ履歴の min/max に自動スケールする（ネットワーク速度向け）。
export function historyToPoints(history: number[], w: number, h: number, range?: [number, number]): number[] {
  if (history.length < 2) return [];
  const [min, max] = graphScale(history, range);
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
