import { createPanel, createItem, type Panel, type PanelItem } from "$lib/model/panel";
import { sensors } from "$lib/sensors/live.svelte";
import { pickSensor } from "$lib/sensors/match";
import { formatForUnit } from "$lib/render/format";

// 数値中心のシンプルなテンプレ。大きな読み取り値を並べ、下に細い1本グラフ。
export function buildMinimalTemplate(): Panel {
  const panel = createPanel(1920, 480);
  const items: PanelItem[] = [];
  const add = <T extends PanelItem>(it: T): T => { items.push(it); return it; };
  const bind = (type: string, kw: string[]) => pickSensor(sensors.list, type, kw)?.id;
  const unitOf = (id?: string) => sensors.list.find((s) => s.id === id)?.unit;

  const cell = (x: number, y: number, title: string, sensor: string | undefined, sum?: string[]) => {
    const lab = createItem("Label", { x, y }); lab.format = title; lab.style.fontSize = 16; lab.style.color = "#8aa"; lab.rect.w = 360; add(lab);
    const val = createItem("SensorText", { x, y: y + 22 });
    val.format = sum ? "%d W" : formatForUnit(unitOf(sensor));
    if (sum) val.sensorSum = sum; else val.sensorSrc = sensor;
    val.style.fontSize = 60; val.style.color = "#eee8d6"; val.rect.w = 360; val.rect.h = 70; add(val);
  };

  const cpuTemp = bind("Temperature", ["CPU パッケージ", "CPU Package", "パッケージ", "CPU"]);
  const cpuLoad = bind("Load", ["Total CPU", "合計 CPU", "CPU Total", "CPU 使用", "Total"]);
  const gpuTemp = bind("Temperature", ["GPU 温度", "GPU Temperature", "GPU"]);
  const gpuLoad = bind("Load", ["GPU Core", "GPU 使用", "GPU Utilization", "GPU"]);
  const dram = bind("Load", ["仮想メモリ", "物理メモリ", "メモリ使用", "メモリ", "Memory", "RAM"]);
  const vram = bind("Load", ["GPU メモリ", "VRAM", "GPU Memory", "Memory Used"]);
  const cpuPower = bind("Power", ["CPU パッケージ", "CPU Package Power", "CPU"]);
  const gpuPower = bind("Power", ["GPU Power", "GPU 電力", "GPU"]);
  const netDown = pickSensor(sensors.list, "", ["ダウンロード", "Download", "受信", "DL"])?.id;

  const xs = [80, 560, 1040, 1520];
  cell(xs[0], 60, "CPU TEMP", cpuTemp);
  cell(xs[1], 60, "CPU LOAD", cpuLoad);
  cell(xs[2], 60, "GPU TEMP", gpuTemp);
  cell(xs[3], 60, "GPU LOAD", gpuLoad);
  cell(xs[0], 200, "DRAM", dram);
  cell(xs[1], 200, "VRAM", vram);
  cell(xs[2], 200, "TOTAL POWER", undefined, [cpuPower, gpuPower].filter(Boolean) as string[]);

  const clock = createItem("DateTime", { x: xs[3], y: 222 });
  clock.format = "HH:mm:ss"; clock.style.fontSize = 60; clock.style.color = "#eee8d6"; clock.rect.w = 360; add(clock);
  const clab = createItem("Label", { x: xs[3], y: 200 }); clab.format = "CLOCK"; clab.style.fontSize = 16; clab.style.color = "#8aa"; clab.rect.w = 360; add(clab);

  const graph = createItem("GraphLine", { x: 80, y: 350 });
  graph.rect.w = 1760; graph.rect.h = 100; graph.unit = "B/s"; graph.autoUnit = true; graph.bgOpacity = 0.2;
  graph.graphStyle = "filled"; graph.style.color = "#00d2c4"; graph.sensorSrc = netDown;
  add(graph);

  panel.items = items;
  return panel;
}
