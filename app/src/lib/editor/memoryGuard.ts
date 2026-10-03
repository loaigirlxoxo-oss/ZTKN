import { invoke } from "@tauri-apps/api/core";
import { editor } from "$lib/editor/editorState.svelte";
import { view } from "$lib/editor/view.svelte";
import { RESET_STATE_KEY as KEY, decodeResetState, mustWaitForIdle, type SavedState } from "./resetState";

// ページを描くプロセス（WebView2 の renderer）のメモリが溜まりすぎたら、画面を読み込み直す。
//
// ライブ値をイベントで受けるのをやめた後も、1 時間あたり約 4MB ずつ増える（9 時間で 77→112MB）。
// 読み込み直すと同じプロセスのまま手放される（実測 113→86MB）。表示専用画面のまま使っている人が
// 気づかないよう、直前に表示状態とパネルを保存し、読み込み直した直後に戻す。

const CHECK_MS = 10 * 60 * 1000; // 10 分ごとに測る
const LIMIT_MB = 500;            // 起動直後は約 80MB。今の増え方で 3〜4 日に 1 回
const IDLE_MS = 60 * 1000;       // 編集画面で直近 1 分に操作があれば、止まるまで待つ

/** 読み込み直しの前に保存した状態があれば戻す。ページの起動処理より前に呼ぶ。 */
export function restoreAfterReset(): boolean {
  let raw: string | null = null;
  try { raw = sessionStorage.getItem(KEY); sessionStorage.removeItem(KEY); } catch { return false; }
  const s = decodeResetState(raw);
  if (!s) return false; // 無い・壊れているなら普通に起動する
  editor.replacePanel(s.panel);
  editor.zoom = s.zoom;
  view.present = s.present;
  return true;
}

let lastInput = Date.now();
let started = false;

/** 定期的に測って、溜まっていれば保存して読み込み直す。 */
export function startMemoryGuard(): void {
  if (started) return;
  started = true;
  const touch = () => { lastInput = Date.now(); };
  for (const ev of ["pointerdown", "pointermove", "keydown", "wheel"]) {
    window.addEventListener(ev, touch, { passive: true });
  }
  setInterval(() => { void check(); }, CHECK_MS);
}

async function check(): Promise<void> {
  let mb: number | null = null;
  try { mb = await invoke<number | null>("renderer_memory_mb"); } catch { return; }
  if (mb == null || mb < LIMIT_MB) return;
  if (mustWaitForIdle(view.present, Date.now() - lastInput, IDLE_MS)) {
    setTimeout(() => { void check(); }, IDLE_MS); // 操作が止まるのを待って測り直す
    return;
  }
  const state: SavedState = { present: view.present, panel: editor.panel, zoom: editor.zoom };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    return; // 保存できないなら、状態を失うより読み込み直さないほうがよい
  }
  console.info(`[memoryGuard] renderer ${mb}MB ≥ ${LIMIT_MB}MB。状態を保存して読み込み直す`);
  location.reload();
}
