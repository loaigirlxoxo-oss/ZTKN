export interface DummySensor { id: string; label: string; min: number; max: number; }

// AIDA64互換IDで主要なものをダミー定義（Phase2でLHM実値に差し替え）
export const DUMMY_SENSORS: DummySensor[] = [
  { id: "SCPUUTI", label: "CPU使用率", min: 0, max: 100 },
  { id: "TCPU", label: "CPU温度", min: 30, max: 95 },
  { id: "SCPUCLK", label: "CPUクロック", min: 800, max: 5200 },
  { id: "SGPU1UTI", label: "GPU使用率", min: 0, max: 100 },
  { id: "TGPU1DIO", label: "GPU温度", min: 30, max: 85 },
  { id: "SMEMUTI", label: "メモリ使用率", min: 0, max: 100 },
  { id: "SNETDLRATE", label: "NW 下り(Mbps)", min: 0, max: 600 },
  { id: "SNETULRATE", label: "NW 上り(Mbps)", min: 0, max: 200 },
];

// 時刻に対して滑らかに揺れる決定的サイン波。乱数を使わずテスト可能に。
export function dummyValue(id: string, timeMs: number): number {
  const s = DUMMY_SENSORS.find((x) => x.id === id);
  if (!s) return NaN;
  const seed = id.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const t = timeMs / 1000;
  const f = (Math.sin(t * 0.6 + seed) + 1) / 2; // 0..1
  return s.min + (s.max - s.min) * f;
}
