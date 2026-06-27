<script lang="ts">
  import { onMount } from "svelte";
  import Editor from "$lib/components/Editor.svelte";
  import { editor } from "$lib/editor/editorState.svelte";
  import { sensors } from "$lib/sensors/live.svelte";
  import { pickSensor } from "$lib/sensors/match";
  import { createItem, type PanelItem } from "$lib/model/panel";

  onMount(() => {
    // 初回のみサンプルを配置（センサーは実データ到着後に自動割当）
    if (editor.panel.items.length === 0) {
      const g = createItem("Gauge", { x: 60, y: 60 }); g.format = "%d%";
      const l = createItem("Label", { x: 260, y: 60 }); l.format = "CPU TEMP"; l.style.color = "#888";
      const t = createItem("SensorText", { x: 260, y: 90 }); t.format = "%d °C"; t.style.fontSize = 44; t.rect.w = 200;
      const bar = createItem("BarH", { x: 60, y: 220 }); bar.rect.w = 300;
      const gl = createItem("Label", { x: 560, y: 60 }); gl.format = "NET DOWN"; gl.style.color = "#888";
      const graph = createItem("GraphLine", { x: 560, y: 90 }); graph.rect.w = 340; graph.rect.h = 120; graph.style.color = "#00ffcc"; graph.unit = "B/s"; graph.bgOpacity = 0.3;
      editor.panel.items.push(g, l, t, bar, gl, graph);
      editor.bumpStructure();

      // 実センサーが揃ったら、サンプルへベストマッチを一度だけ割り当てる
      sensors.whenReady((list) => {
        const bind = (it: PanelItem, type: string, kw: string[]) => {
          const s = pickSensor(list, type, kw);
          if (s) it.sensorSrc = s.id;
        };
        bind(g, "Load", ["Total CPU Usage", "CPU Total", "Total"]);
        bind(t, "Temperature", ["CPU Package", "CPU (Tctl", "CPU Die", "Core Temperatures", "CPU"]);
        bind(bar, "Load", ["Physical Memory Load", "Memory Usage", "Memory", "RAM"]);
        bind(graph, "", ["Total DL", "Download Rate", "Current DL", "Download", "DL Rate"]);
        editor.bumpStructure();
      });
    }
    sensors.start();
  });
</script>

<Editor />

<style>
  :global(body) { margin: 0; background: #0a0a0a; font-family: sans-serif; }
</style>
