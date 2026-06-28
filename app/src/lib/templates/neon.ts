import { createPanel, createItem, type Panel, type PanelItem } from "$lib/model/panel";
import { sensors } from "$lib/sensors/live.svelte";
import { pickSensor, pickNetwork } from "$lib/sensors/match";
import { formatForUnit } from "$lib/render/format";

// 素材を使わず、うちのベクター描画＋実センサーで組む 1920x480 テンプレ「Neon」。
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
  const text = (x: number, y: number, sensor: string | undefined, size: number, color: string, w = 180, align: "left" | "center" = "left") => {
    const it = createItem("SensorText", { x, y });
    it.format = formatForUnit(unitOf(sensor)); it.sensorSrc = sensor;
    it.style.fontSize = size; it.style.color = color; it.style.align = align;
    it.rect.w = w; it.rect.h = size + 8;
    return add(it);
  };
  const bar = (x: number, y: number, sensor: string | undefined, color: string, grad: string, w = 280) => {
    const it = createItem("BarH", { x, y });
    it.rect.w = w; it.rect.h = 24; it.sensorSrc = sensor; it.range = [0, 100];
    it.style.color = color; it.useGradient = true; it.gradColor = grad;
    return add(it);
  };
  // 丸ゲージ＝負荷、中央に負荷%／仕切り線／温度
  const gaugeModule = (x: number, y: number, size: number, loadSensor: string | undefined, tempSensor: string | undefined, color: string) => {
    const g = createItem("Gauge", { x, y });
    g.rect.w = size; g.rect.h = size; g.sensorSrc = loadSensor; g.range = [0, 100]; g.style.color = color; g.format = "%d";
    add(g);
    text(x, y + size * 0.27, loadSensor, size * 0.23, "#eee8d6", size, "center");
    const ln = createItem("Line", { x: x + size * 0.30, y: y + size * 0.50 });
    ln.rect.w = size * 0.40; ln.rect.h = 4; ln.style.color = "#cccccc"; ln.lineWidth = 1; add(ln);
    text(x, y + size * 0.55, tempSensor, size * 0.18, "#eee8d6", size, "center");
  };
  // 丸ゲージ＝1値（中央に数値のみ）
  const gaugeOne = (x: number, y: number, size: number, sensor: string | undefined, color: string) => {
    const g = createItem("Gauge", { x, y });
    g.rect.w = size; g.rect.h = size; g.sensorSrc = sensor; g.range = [0, 100]; g.style.color = color; g.format = "%d";
    add(g);
    text(x, y + size * 0.37, sensor, size * 0.24, "#eee8d6", size, "center");
  };

  // --- センサーを実機にバインド ---
  const cpuTemp = bind("Temperature", ["CPU パッケージ", "CPU Package", "パッケージ"]);
  const cpuLoad = bind("", ["総 CPU 使用率", "Total CPU Usage", "合計 CPU", "CPU 使用率"]);
  const gpuTemp = bind("Temperature", ["GPU 温度", "GPU Temperature"]);
  const gpuLoad = bind("", ["GPU コア使用率", "GPU Core Load", "GPU コア", "GPU Utilization"]);
  const vram = bind("", ["GPU メモリ使用", "GPU Memory Usage", "VRAM"]);
  const dram = bind("", ["物理メモリ使用率", "Physical Memory Load", "物理メモリ"]);
  const cpuPower = bind("Power", ["CPU パッケージ", "CPU Package Power", "CPU PPT"]);
  const gpuPower = bind("Power", ["GPU 電力", "GPU Power"]);
  const netDown = pickNetwork(sensors.list, ["download", "ダウンロード", "受信", "dl"], ["イーサネット", "ethernet"])?.id;
  const netUp = pickNetwork(sensors.list, ["upload", "アップロード", "送信", "ul", "上り"], ["イーサネット", "ethernet"])?.id;

  const WARM = "#ffb14e", COOL = "#00d2c4", GREEN = "#6af62a", PINK = "#ff3484";

  // --- CPU（左）＋ DRAM（CPUの横） ---
  label("CPU", 70, 50, 20, WARM);
  gaugeModule(80, 90, 190, cpuLoad, cpuTemp, WARM);
  label("DRAM", 320, 110, 18, "#ffd23f");
  gaugeOne(310, 140, 150, dram, "#ffd23f");

  // --- 中央：ネットワーク / 電力 / 時計 ---
  label("NETWORK  ↓ / ↑", 660, 56, 14, COOL);
  const graph = createItem("GraphLine", { x: 660, y: 84 });
  graph.rect.w = 600; graph.rect.h = 150; graph.unit = "Kbps"; graph.autoUnit = true; graph.bgOpacity = 0.25; graph.valueScale = 8; // KB/s→Kbps
  graph.graphStyle = "dual-basic"; graph.style.color = COOL; graph.color2 = PINK;
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
  label("GPU", 1640, 50, 20, COOL);
  gaugeModule(1650, 90, 190, gpuLoad, gpuTemp, COOL);
  label("VRAM", 1540, 320, 14);
  bar(1540, 342, vram, "#8652ff", "#ff3484", 300);
  text(1852, 340, vram, 22, "#ccc", 60);

  panel.items = items;
  return panel;
}
