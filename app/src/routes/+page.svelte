<script lang="ts">
  import { onMount } from "svelte";
  import Editor from "$lib/components/Editor.svelte";
  import { editor } from "$lib/editor/editorState.svelte";
  import { startDummyLoop } from "$lib/sensors/loop";
  import { createItem } from "$lib/model/panel";

  onMount(() => {
    // 初回のみサンプルを配置（見た目確認用）
    if (editor.panel.items.length === 0) {
      const g = createItem("Gauge", { x: 60, y: 60 }); g.sensorSrc = "SCPUUTI"; g.format = "%d%";
      const t = createItem("SensorText", { x: 260, y: 90 }); t.sensorSrc = "TCPU"; t.format = "%d °C"; t.style.fontSize = 44; t.rect.w = 200;
      const l = createItem("Label", { x: 260, y: 60 }); l.format = "CPU TEMP"; l.style.color = "#888";
      const bar = createItem("BarH", { x: 60, y: 220 }); bar.sensorSrc = "SMEMUTI"; bar.rect.w = 300;
      const gl = createItem("Label", { x: 560, y: 60 }); gl.format = "NET DOWN (Mbps)"; gl.style.color = "#888";
      const graph = createItem("GraphLine", { x: 560, y: 90 }); graph.sensorSrc = "SNETDLRATE"; graph.rect.w = 340; graph.rect.h = 120; graph.style.color = "#00ffcc";
      editor.panel.items.push(g, l, t, bar, gl, graph);
      editor.bumpStructure();
    }
    return startDummyLoop((m) => editor.setValues(m));
  });
</script>

<Editor />

<style>
  :global(body) { margin: 0; background: #0a0a0a; font-family: sans-serif; }
</style>
