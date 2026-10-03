import type { Panel } from "../model/panel";

// 画面を読み込み直す前に保存する状態。memoryGuard.ts が保存し、起動時に戻す。
export const RESET_STATE_KEY = "ztkn-reset-state";

export interface SavedState { present: boolean; panel: Panel; zoom: number }

/** 保存した文字列を読み解く。形が合わなければ null（壊れた保存で起動を止めない）。 */
export function decodeResetState(raw: string | null): SavedState | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<SavedState>;
    if (typeof s.present !== "boolean" || typeof s.zoom !== "number") return null;
    if (!s.panel || !Array.isArray(s.panel.items) || typeof s.panel.size?.w !== "number") return null;
    return { present: s.present, panel: s.panel, zoom: s.zoom };
  } catch {
    return null;
  }
}

/**
 * 読み込み直しを待つべきか。編集の途中（ドラッグ中・入力の確定前）に読み込み直すと
 * その操作が失われるので、編集画面では最後の操作から idleMs たつまで待つ。
 * 表示専用画面では編集しないので待たない（カーソルを置いたままだと先延ばしになり続ける）。
 */
export function mustWaitForIdle(present: boolean, sinceLastInputMs: number, idleMs: number): boolean {
  return !present && sinceLastInputMs < idleMs;
}
