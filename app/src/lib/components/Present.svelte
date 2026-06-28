<script lang="ts">
  import { onMount } from "svelte";
  import CanvasStage from "./CanvasStage.svelte";
  import { view } from "$lib/editor/view.svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";

  async function exitPresent(): Promise<void> {
    view.present = false;
    try { await getCurrentWindow().setFullscreen(false); } catch { /* 非Tauri実行時は無視 */ }
  }

  onMount(() => {
    // 入った瞬間にフルスクリーン化。Esc またはダブルクリックで編集へ戻る。
    getCurrentWindow().setFullscreen(true).catch(() => {});
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
