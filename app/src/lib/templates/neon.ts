import { createPanel, createItem, type Panel, type PanelItem } from "$lib/model/panel";
import { sensors } from "$lib/sensors/live.svelte";
import { pickSensor } from "$lib/sensors/match";
import { formatForUnit } from "$lib/render/format";

// 素材を使わず、うちのベクター描画＋実センサーで組む 1920x480 テンプレ「Neon」。
// センサーは実行時にライブ一覧へキーワードでベストバインド（決め打ちパスなし）。
export function buildNeonTemplate(): Panel {
  const panel = createPanel(1920, 480);
  const items: PanelItem[] = [];
  const add = <T extends PanelItem>(it: T): T => { items.push(it); return it; };
  const bind = (type: string, kw: string[]) => pickSensor(sensors.list, type, kw)?.id;
  const unitOf = (id?: string) => sensors.list.find((s) => s.id === id)?.unit;

  const label = (txt: string, x: number, y: number, size = 14, color = "#8a8") => {
    const it = createItem("Label", { x, y });
    it.format = txt; it.style.fontSize = size; it.style.color = color; it.rect.w = 220;
    return add(it);
  };
  // 数値表示。format はセンサーの単位から自動（℃/%/W等を手書きしない）
  const text = (x: number, y: number, sensor: string | undefined, size: number, color: string, w = 180) => {
    const it = createItem("SensorText", { x, y });
    it.format = formatForUnit(unitOf(sensor)); it.sensorSrc = sensor; it.style.fontSize = size; it.style.color = color;
    it.rect.w = w; it.rect.h = size + 8;
    return add(it);
  };
  const gauge = (x: number, y: number, sensor: string | undefined, range: [number, number], color: string) => {
    const it = createItem("Gauge", { x, y });
    it.rect.w = 130; it.rect.h = 130; it.sensorSrc = sensor; it.range = range; it.style.color = color; it.format = "%d";
    return add(it);
  };
  const bar = (x: number, y: number, sensor: string | undefined, color: string, grad: string, w = 280) => {
    const it = createItem("BarH", { x, y });
    it.rect.w = w; it.rect.h = 24; it.sensorSrc = sensor; it.range = [0, 100];
    it.style.color = color; it.useGradient = true; it.gradColor = grad;
    return add(it);
  };

  // --- センサーを実機にバインド ---
  const cpuTemp = bind("Temperature", ["CPU パッケージ", "CPU Package", "パッケージ", "CPU"]);
  const cpuLoad = bind("Load", ["Total CPU", "合計 CPU", "CPU Total", "CPU 使用", "Total"]);
  const gpuTemp = bind("Temperature", ["GPU 温度", "GPU Temperature", "GPU Hot", "GPU"]);
  const gpuLoad = bind("Load", ["GPU Core", "GPU 使用", "GPU Utilization", "GPU"]);
  const vram = bind("Load", ["GPU メモリ", "VRAM", "GPU Memory", "Memory Used"]);
  const dram = bind("Load", ["仮想メモリ", "物理メモリ", "メモリ使用", "メモリ", "Memory", "RAM"]);
  const cpuPower = bind("Power", ["CPU パッケージ", "CPU Package Power", "CPU PPT", "CPU"]);
  const gpuPower = bind("Power", ["GPU Power", "GPU 電力", "GPU"]);
  const netDown = pickSensor(sensors.list, "", ["ダウンロード", "Download", "受信", "DL"])?.id;
  const netUp = pickSensor(sensors.list, "", ["アップロード", "Upload", "送信", "UL", "上り"])?.id;

  const WARM = "#ffb14e", COOL = "#00d2c4", GREEN = "#6af62a", PINK = "#ff3484";

  // --- CPU（左） ---
  label("CPU", 60, 56, 20, WARM);
  gauge(96, 100, cpuTemp, [20, 95], WARM);
  text(250, 116, cpuTemp, 54, "#eee8d6", 200);
  label("LOAD", 60, 300, 14);
  bar(60, 320, cpuLoad, GREEN, "#ff5a3c");
  text(352, 318, cpuLoad, 22, "#ccc", 90);
  label("DRAM", 60, 360, 14);
  bar(60, 380, dram, "#ffd23f", "#ff5a3c");
  text(352, 378, dram, 22, "#ccc", 90);

  // --- 中央：ネットワーク / 電力 / 時計 ---
  label("NETWORK  ↓ / ↑", 660, 56, 14, COOL);
  const graph = createItem("GraphLine", { x: 660, y: 84 });
  graph.rect.w = 600; graph.rect.h = 150; graph.unit = "B/s"; graph.autoUnit = true; graph.bgOpacity = 0.25;
  graph.graphStyle = "dual-mirrored"; graph.style.color = COOL; graph.color2 = PINK;
  graph.sensorSrc = netDown; graph.sensorSrc2 = netUp;
  add(graph);
  label("TOTAL POWER", 660, 268, 14);
  const power = createItem("SensorText", { x: 660, y: 288 });
  power.format = "%d W"; power.style.fontSize = 48; power.style.color = "#ffffff"; power.rect.w = 240; power.rect.h = 56;
  power.sensorSum = [cpuPower, gpuPower].filter(Boolean) as string[];
  add(power);
  const clock = createItem("DateTime", { x: 980, y: 282 });
  clock.format = "HH:mm:ss"; clock.style.fontSize = 52; clock.style.color = "#eee8d6"; clock.rect.w = 280;
  add(clock);
  const date = createItem("DateTime", { x: 980, y: 350 });
  date.format = "yyyy-MM-dd"; date.style.fontSize = 22; date.style.color = "#9aa"; date.rect.w = 220;
  add(date);

  // --- GPU（右） ---
  label("GPU", 1700, 56, 20, COOL);
  gauge(1700, 100, gpuTemp, [20, 90], COOL);
  text(1470, 116, gpuTemp, 54, "#eee8d6", 200);
  label("LOAD", 1540, 300, 14);
  bar(1540, 320, gpuLoad, COOL, "#8652ff");
  text(1832, 318, gpuLoad, 22, "#ccc", 80);
  label("VRAM", 1540, 360, 14);
  bar(1540, 380, vram, "#8652ff", "#ff3484");
  text(1832, 378, vram, 22, "#ccc", 80);

  panel.items = items;
  return panel;
}
