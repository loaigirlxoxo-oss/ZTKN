import { invoke } from "@tauri-apps/api/core";
import { createPanel, createItem, type Panel } from "$lib/model/panel";
import { sensors } from "$lib/sensors/live.svelte";
import { pickSensor } from "$lib/sensors/match";

// AIDA64 スキン素材（guide/layout.json）を読み、本アプリの Panel を組み立てる。
// 状態ゲージは StateFrames（state-01..NN）で再現、センサーは実機にベストバインドする。

interface Concept { type: string; kw: string[]; format: string; range: [number, number]; }

// レイアウトのセンサー概念 → 実センサー検索条件（日本語HWiNFO名/英語の両対応キーワード）。
const CONCEPTS: Record<string, Concept> = {
  cpuTemp: { type: "Temperature", kw: ["CPU パッケージ", "CPU Package", "パッケージ", "CPU"], format: "%d ℃", range: [20, 95] },
  gpuTemp: { type: "Temperature", kw: ["GPU 温度", "GPU Temperature", "GPU Hot", "GPU"], format: "%d ℃", range: [20, 90] },
  memUtil: { type: "Load", kw: ["仮想メモリ", "物理メモリ", "メモリ使用率", "メモリ", "Memory", "RAM"], format: "%d%", range: [0, 100] },
  vramUtil: { type: "Load", kw: ["GPU メモリ", "GPUメモリ", "VRAM", "GPU Memory", "Memory Usage"], format: "%d%", range: [0, 100] },
  cpuClock: { type: "Clock", kw: ["P-core", "コア クロック", "Core Clock", "CPU Clock", "Clock"], format: "%d MHz", range: [0, 6000] },
  netDown: { type: "", kw: ["ダウンロード", "Download", "受信", "DL", "In"], format: "", range: [0, 1000] },
};

function bind(concept: string): string | undefined {
  const c = CONCEPTS[concept];
  return c ? pickSensor(sensors.list, c.type, c.kw)?.id : undefined;
}

function join(root: string, rel: string): string {
  return root.replace(/\\/g, "/").replace(/\/+$/, "") + "/" + rel.replace(/^\/+/, "");
}

const ITEM_CONCEPT: Record<string, string> = {
  "CPU Round Gauge": "cpuTemp",
  "GPU Round Gauge": "gpuTemp",
  "RAM Bar": "memUtil",
  "VRAM Bar": "vramUtil",
};
const TEXT_CONCEPT: Record<string, string> = {
  "CPU Number": "cpuTemp",
  "GPU Number": "gpuTemp",
  "RAM Number": "memUtil",
  "VRAM Number": "vramUtil",
  "Clock": "cpuClock",
};

export async function importAida64Layout(rootDir: string): Promise<Panel> {
  const json = await invoke<string>("read_text_file", { path: join(rootDir, "guide/layout.json") });
  const layout = JSON.parse(json);
  const panel = createPanel(layout.panel.width, layout.panel.height);
  if (layout.recommended_dynamic_background) {
    panel.background = join(rootDir, layout.recommended_dynamic_background);
  }

  for (const it of layout.items ?? []) {
    if (it.type === "AIDA64 Custom Gauge") {
      const frames = await invoke<string[]>("list_dir_images", { dir: join(rootDir, it.states) });
      const item = createItem("Gauge", { x: it.x, y: it.y });
      item.rect = { x: it.x, y: it.y, w: it.width, h: it.height };
      item.gauge = { mode: "StateFrames", frames };
      const concept = ITEM_CONCEPT[it.name];
      if (concept) { item.range = CONCEPTS[concept].range; item.sensorSrc = bind(concept); }
      panel.items.push(item);
    } else if (it.type === "AIDA64 native Graph") {
      const item = createItem("GraphLine", { x: it.x, y: it.y });
      item.rect = { x: it.x, y: it.y, w: it.width, h: it.height };
      item.unit = "B/s"; item.autoUnit = true; item.bgOpacity = 0.2; item.style.color = "#00d2c4";
      item.sensorSrc = bind("netDown");
      panel.items.push(item);
    }
  }

  for (const t of layout.text_items ?? []) {
    const concept = TEXT_CONCEPT[t.name];
    const c = concept ? CONCEPTS[concept] : undefined;
    const item = createItem("SensorText", { x: t.x, y: t.y });
    item.rect = { x: t.x, y: t.y, w: 220, h: t.font_size + 8 };
    item.style.fontSize = t.font_size;
    item.style.color = t.color ?? "#eee8d6";
    item.format = c?.format ?? "%d";
    if (concept) item.sensorSrc = bind(concept);
    panel.items.push(item);
  }

  return panel;
}
