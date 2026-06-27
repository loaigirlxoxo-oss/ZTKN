import type { LiveSensor } from "./live.svelte";

// 実センサー一覧から、種別(type)と名前キーワードでベストマッチを1つ選ぶ（サンプル自動割当用）。
export function pickSensor(list: LiveSensor[], type: string, nameIncludes: string[] = []): LiveSensor | undefined {
  const byType = list.filter((s) => s.type === type);
  for (const kw of nameIncludes) {
    const hit = byType.find((s) => s.name.toLowerCase().includes(kw.toLowerCase()));
    if (hit) return hit;
  }
  return byType[0];
}
