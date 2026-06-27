<script lang="ts">
  import { editor } from "$lib/editor/editorState.svelte";
  import type { ItemKind } from "$lib/model/panel";

  const kinds: { kind: ItemKind; label: string }[] = [
    { kind: "Label", label: "▢ ラベル" },
    { kind: "SensorText", label: "# センサー値" },
    { kind: "Gauge", label: "◔ ゲージ" },
    { kind: "GraphLine", label: "∿ グラフ" },
    { kind: "BarH", label: "▭ 横バー" },
    { kind: "BarV", label: "▯ 縦バー" },
  ];
</script>

<div class="palette">
  <div class="title">追加</div>
  {#each kinds as k}
    <button onclick={() => editor.addItem(k.kind)}>{k.label}</button>
  {/each}
</div>

<style>
  .palette { display: flex; flex-direction: column; gap: 4px; padding: 8px; background: #161616; min-width: 120px; }
  .title { color: #888; font-size: 12px; margin-bottom: 4px; }
  button { padding: 6px; background: #2a2a2a; color: #ddd; border: 1px solid #3a3a3a; cursor: pointer; text-align: left; }
  button:hover { background: #333; }
</style>
