import { availableMonitors, type Monitor } from "@tauri-apps/api/window";

// 接続中ディスプレイの一覧と、表示専用で使うモニタの選択を保持する。
export const monitorStore = $state<{ list: Monitor[]; selected: number }>({ list: [], selected: 0 });

const STORAGE_KEY = "present-monitor"; // 選択モニタ名を記憶

export async function loadMonitors(): Promise<void> {
  try {
    const ms = await availableMonitors();
    monitorStore.list = ms;
    // 前回選択したモニタ名があれば復元（つなぎ替えで番号がずれても名前で追従）
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const i = ms.findIndex((m) => (m.name ?? "") === saved);
      monitorStore.selected = i >= 0 ? i : Math.min(monitorStore.selected, ms.length - 1);
    } else if (monitorStore.selected >= ms.length) {
      monitorStore.selected = 0;
    }
  } catch {
    // 非Tauri実行時などは空のまま（フォールバック＝現在のウィンドウでフルスクリーン）
  }
}

export function selectMonitor(i: number): void {
  monitorStore.selected = i;
  const m = monitorStore.list[i];
  if (m) localStorage.setItem(STORAGE_KEY, m.name ?? "");
}

export function selectedMonitor(): Monitor | undefined {
  return monitorStore.list[monitorStore.selected];
}

// 人間向けラベル（名前＋解像度）。名前が取れない環境向けに番号も付ける。
export function monitorLabel(m: Monitor, i: number): string {
  const name = m.name && m.name.trim() ? m.name : `ディスプレイ${i + 1}`;
  return `${name} (${m.size.width}×${m.size.height})`;
}
