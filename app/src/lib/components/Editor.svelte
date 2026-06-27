<script lang="ts">
  import Palette from "./Palette.svelte";
  import CanvasStage from "./CanvasStage.svelte";
  import Properties from "./Properties.svelte";
  import { editor } from "$lib/editor/editorState.svelte";
  import { sensors } from "$lib/sensors/live.svelte";
  import { savePanel, loadPanel } from "$lib/editor/persist";

  let msg = $state("");

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

<div class="toolbar">
  <button onclick={doSave}>保存</button>
  <button onclick={doLoad}>読込</button>
  <span class="sep">|</span>
  <label class="size">レイアウト幅 <input type="number" min="100" bind:value={editor.panel.size.w} /></label>
  <label class="size">高さ <input type="number" min="100" bind:value={editor.panel.size.h} /></label>
  <span class="sep">|</span>
  <span class="sensor-status">🌡 {sensors.status}</span>
  <span class="msg">{msg}</span>
</div>

<div class="editor">
  <Palette />
  <div class="canvas-wrap"><CanvasStage /></div>
  <Properties />
</div>

<style>
  .toolbar { display: flex; gap: 8px; align-items: center; padding: 6px 8px; background: #111; border-bottom: 1px solid #222; }
  .toolbar button { padding: 4px 12px; background: #2a2a2a; color: #ddd; border: 1px solid #3a3a3a; cursor: pointer; }
  .sep { color: #444; }
  .size { color: #aaa; font-size: 12px; display: flex; align-items: center; gap: 4px; }
  .size input { width: 70px; background: #222; color: #ddd; border: 1px solid #3a3a3a; }
  .sensor-status { color: #8ab; font-size: 12px; }
  .msg { color: #00ffcc; font-size: 12px; }
  .editor { display: flex; align-items: flex-start; height: calc(100vh - 41px); }
  .canvas-wrap { flex: 1; padding: 16px; overflow: auto; }
</style>
