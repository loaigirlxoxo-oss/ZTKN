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

// サイドカーが、電力を返さない NVIDIA GPU に付ける推定値のセンサー名（GpuPowerEstimator.cs と一致させる）。
export const GPU_POWER_ESTIMATED = "GPU Power (Estimated)";

// 総電力（CPU+GPU）に使う GPU の電力。本物を優先し、ドライバが電力を返さない機種では推定値を使う。
function gpuPower(list: LiveSensor[]): LiveSensor | undefined {
  return pickLhm(list, "GPU Package", "Power", "NVIDIA")
    ?? pickLhm(list, "GPU Package", "Power")
    ?? pickLhm(list, GPU_POWER_ESTIMATED, "Power");
}

// 総電力（CPU+GPU）として足すセンサーID。プロパティの「★ Total Power」とテンプレートで共用する。
export function totalPowerIds(list: LiveSensor[]): string[] {
  const cpu = pickLhm(list, "CPU Package", "Power");
  return [cpu?.id, gpuPower(list)?.id].filter(Boolean) as string[];
}

// 総電力の GPU 分が推定値かどうか。表示に「推定」と添えるために使う。
export function gpuPowerIsEstimated(list: LiveSensor[]): boolean {
  return gpuPower(list)?.name === GPU_POWER_ESTIMATED;
}

// サイドカーが出す PC 全体（コンセント側）の推定電力。pc-profile.json の部品構成から足している。
export const SYSTEM_POWER_ESTIMATED = "System Power (Estimated)";
export function systemPowerId(list: LiveSensor[]): string | undefined {
  return pickLhm(list, SYSTEM_POWER_ESTIMATED, "Power", "PC")?.id;
}
