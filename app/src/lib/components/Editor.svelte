<script lang="ts">
  import { onMount } from "svelte";
  import Palette from "./Palette.svelte";
  import CanvasStage from "./CanvasStage.svelte";
  import Properties from "./Properties.svelte";
  import AssetLibrary from "./AssetLibrary.svelte";
  import { editor } from "$lib/editor/editorState.svelte";
  import { sensors } from "$lib/sensors/live.svelte";
  import { savePanel, loadPanel } from "$lib/editor/persist";

  let msg = $state("");
  let showAssets = $state(true);
  let wrapEl: HTMLDivElement | undefined = $state();

  // 表示倍率をビューポートに合わせる
  function fitZoom(): void {
    if (!wrapEl) return;
    const zw = (wrapEl.clientWidth - 32) / editor.panel.size.w;
    const zh = (wrapEl.clientHeight - 32) / editor.panel.size.h;
    editor.zoom = Math.max(0.1, Math.min(zw, zh));
  }

  // キーボードショートカット（フォーム入力中はネイティブに任せる）
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (ctrl && k === "z") { e.preventDefault(); if (e.shiftKey) editor.redo(); else editor.undo(); return; }
      if (ctrl && k === "y") { e.preventDefault(); editor.redo(); return; }
      if (ctrl && k === "d") { e.preventDefault(); editor.duplicateSelected(); return; }
      if (ctrl && k === "c") { editor.copySelected(); return; }
      if (ctrl && k === "v") { editor.paste(); return; }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); editor.deleteSelected(); return; }
      const step = e.shiftKey ? 10 : 1;
      if (e.key === "ArrowLeft") { e.preventDefault(); editor.nudge(-step, 0); }
      else if (e.key === "ArrowRight") { e.preventDefault(); editor.nudge(step, 0); }
      else if (e.key === "ArrowUp") { e.preventDefault(); editor.nudge(0, -step); }
      else if (e.key === "ArrowDown") { e.preventDefault(); editor.nudge(0, step); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function doSave(): Promise<void> {
    try {
      await savePanel("default", editor.panel);
      msg = "保存しました";
    } catch (e) {
      msg = "保存失敗: " + e; // 握りつぶさず表示
    }
  }

  async function doLoad(): Promise<void> {
    try {
      const p = await loadPanel("default");
      editor.replacePanel(p);
      msg = "読込しました";
    } catch (e) {
      msg = "読込失敗: " + e; // 破損時も空で上書きしない
    }
  }
</script>

<div class="column">
  <div class="toolbar">
    <button onclick={doSave}>保存</button>
    <button onclick={doLoad}>読込</button>
    <button onclick={() => editor.undo()} disabled={!editor.canUndo} title="元に戻す (Ctrl+Z)">↶</button>
    <button onclick={() => editor.redo()} disabled={!editor.canRedo} title="やり直し (Ctrl+Y)">↷</button>
    <button onclick={() => (showAssets = !showAssets)}>アセット{showAssets ? "▼" : "▲"}</button>
    <span class="sep">|</span>
    <label class="size">レイアウト幅 <input type="number" min="100" bind:value={editor.panel.size.w} /></label>
    <label class="size">高さ <input type="number" min="100" bind:value={editor.panel.size.h} /></label>
    <span class="sep">|</span>
    <label class="size">表示
      <select bind:value={editor.zoom}>
        <option value={0.25}>25%</option>
        <option value={0.5}>50%</option>
        <option value={0.75}>75%</option>
        <option value={1}>100%</option>
        <option value={1.5}>150%</option>
        <option value={2}>200%</option>
      </select>
    </label>
    <button onclick={fitZoom}>フィット</button>
    <span class="sep">|</span>
    <span class="sensor-status">🌡 {sensors.status}</span>
    <span class="msg">{msg}</span>
  </div>

  <div class="editor">
    <Palette />
    <div class="canvas-wrap" bind:this={wrapEl}><CanvasStage /></div>
    <Properties />
  </div>

  {#if showAssets}
    <div class="drawer"><AssetLibrary /></div>
  {/if}
</div>

<style>
  .column { display: flex; flex-direction: column; height: 100vh; }
  .toolbar { display: flex; gap: 8px; align-items: center; padding: 6px 8px; background: #111; border-bottom: 1px solid #222; flex: 0 0 auto; }
  .toolbar button { padding: 4px 12px; background: #2a2a2a; color: #ddd; border: 1px solid #3a3a3a; cursor: pointer; }
  .sep { color: #444; }
  .size { color: #aaa; font-size: 12px; display: flex; align-items: center; gap: 4px; }
  .size input { width: 70px; background: #222; color: #ddd; border: 1px solid #3a3a3a; }
  .sensor-status { color: #8ab; font-size: 12px; }
  .msg { color: #00ffcc; font-size: 12px; }
  .editor { display: flex; align-items: stretch; flex: 1 1 auto; min-height: 0; }
  .canvas-wrap { flex: 1; padding: 16px; overflow: auto; height: 100%; }
  .drawer { flex: 0 0 38vh; min-height: 0; }
</style>
