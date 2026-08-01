<script lang="ts">
  import { onMount } from "svelte";
  import CanvasStage from "./CanvasStage.svelte";
  import { view } from "$lib/editor/view.svelte";
  import { selectedMonitor } from "$lib/editor/monitors.svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";

  // 表示前のウィンドウ位置/サイズ。表示中はモニタに合わせて変えるので、戻すために覚えておく。
  let prevPos: PhysicalPosition | null = null;
  let prevSize: PhysicalSize | null = null;

  async function exitPresent(): Promise<void> {
    view.present = false;
    try {
      const w = getCurrentWindow();
      await w.setFullscreen(false);
      // 表示用にモニタサイズへ変形しているので編集時のサイズへ戻す
      if (prevPos) await w.setPosition(prevPos);
      if (prevSize) await w.setSize(prevSize);
    } catch { /* 非Tauri実行時は無視 */ }
  }

  // 選択モニタへウィンドウを移してからフルスクリーン化する。
  // setFullscreen は「ウィンドウが最も重なっているモニタ」を全画面化するため、
  // 位置だけ合わせても背の低いモニタ(例:1920x480のストリップ)では下の隣接モニタへはみ出し、
  // そちらが選ばれてしまう。位置とサイズの両方を合わせてから全画面化する。
  async function enterPresent(): Promise<void> {
    const w = getCurrentWindow();
    try {
      const m = selectedMonitor();
      if (m) {
        // 戻り先を控えてから変形する
        prevPos = await w.outerPosition();
        prevSize = await w.outerSize();
        await w.setFullscreen(false);
        await w.setPosition(new PhysicalPosition(m.position.x, m.position.y));
        await w.setSize(new PhysicalSize(m.size.width, m.size.height)); // はみ出しを無くす
        await new Promise((r) => setTimeout(r, 150)); // OS の移動/リサイズ処理を待つ
      }
      await w.setFullscreen(true);
    } catch { /* 非Tauri実行時は無視 */ }
  }

  onMount(() => {
    enterPresent();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); exitPresent(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
</script>

<div class="present" ondblclick={exitPresent} role="presentation">
  <CanvasStage present />
  <div class="hint">Esc / ダブルクリックで編集に戻る</div>
</div>

<style>
  .present { position: fixed; inset: 0; background: #000; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .hint { position: fixed; bottom: 8px; right: 12px; color: #555; font-size: 12px; opacity: 0; transition: opacity 0.2s; pointer-events: none; }
  .present:hover .hint { opacity: 1; }
</style>
