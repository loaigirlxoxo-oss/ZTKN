import type { LiveSensor } from "./live.svelte";

// 実センサー一覧からベストマッチを1つ選ぶ（サンプル自動割当用）。
// type="" のときは種別を問わず名前キーワードのみで探す（HWiNFO/LHM の命名差を吸収）。
export function pickSensor(list: LiveSensor[], type: string, nameIncludes: string[] = []): LiveSensor | undefined {
  const pool = type ? list.filter((s) => s.type === type) : list;
  for (const kw of nameIncludes) {
    const hit = pool.find((s) => s.name.toLowerCase().includes(kw.toLowerCase()));
    if (hit) return hit;
  }
  return type ? pool[0] : undefined; // 種別指定なしはキーワード一致のみ
}
