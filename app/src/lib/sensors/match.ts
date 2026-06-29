import type { LiveSensor } from "./live.svelte";

// ネットワーク速度センサーを、ハードウェア(アダプタ)優先で選ぶ。
// 例: pickNetwork(list, ["download","ダウンロード","受信"], ["イーサネット","ethernet"])
export function pickNetwork(list: LiveSensor[], nameKw: string[], hwKw: string[]): LiveSensor | undefined {
  // 「現在の速度」(/s 単位)だけ対象。総計(MB等の累積カウンタ)は除外する。
  const rateLike = list.filter((s) => s.type === "Throughput" || /\/s|bps/i.test(s.unit));
  const nameHit = (s: LiveSensor) => nameKw.some((n) => s.name.toLowerCase().includes(n.toLowerCase()));
  for (const hk of hwKw) {
    const hit = rateLike.find((s) => s.hw.toLowerCase().includes(hk.toLowerCase()) && nameHit(s));
    if (hit) return hit;
  }
  return rateLike.find(nameHit);
}

// LHM向け：名前完全一致＋型一致（必要ならハード名の部分一致）で1つ選ぶ。
// LHMは "GPU Core" が Load/Clock/Temp で重複するので型で、"Memory" は hw で曖昧さを排除する。
export function pickLhm(list: LiveSensor[], name: string, type: string, hwIncludes?: string): LiveSensor | undefined {
  return list.find((s) => s.name === name && s.type === type && (!hwIncludes || s.hw.includes(hwIncludes)));
}

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
