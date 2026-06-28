import { invoke } from "@tauri-apps/api/core";

// 取得失敗時の最低限の一覧（Windows標準で視認差が大きいもの）
const FALLBACK = ["Segoe UI", "Arial", "Consolas", "Times New Roman", "Comic Sans MS", "Impact", "Meiryo", "MS Gothic"];

// Windows にインストール済みのフォントファミリ一覧。Rust から1回だけ取得する。
export const fontStore = $state<{ list: string[]; loaded: boolean }>({ list: FALLBACK, loaded: false });

let started = false;
export async function ensureFonts(): Promise<void> {
  if (started) return; // 多重取得を防止
  started = true;
  try {
    const names = await invoke<string[]>("list_fonts");
    if (names && names.length) {
      fontStore.list = names;
      fontStore.loaded = true;
    }
  } catch {
    // 取得失敗時は FALLBACK のまま（握りつぶさずフォールバック動作を維持）
  }
}
