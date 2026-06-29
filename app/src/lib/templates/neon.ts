import { createPanel, createItem, type Panel, type PanelItem } from "$lib/model/panel";
import { sensors } from "$lib/sensors/live.svelte";
import { pickLhm, pickNetwork } from "$lib/sensors/match";
import { formatForUnit } from "$lib/render/format";

// 素材を使わず、うちのベクター描画＋実センサーで組む 1920x480 テンプレ「Neon」。
export function buildNeonTemplate(): Panel {
  const panel = createPanel(1920, 480);
  const items: PanelItem[] = [];
  const add = <T extends PanelItem>(it: T): T => { items.push(it); return it; };
  const pick = (name: string, type: string, hwHas?: string) => pickLhm(sensors.list, name, type, hwHas)?.id;
  const unitOf = (id?: string) => sensors.list.find((s) => s.id === id)?.unit;

  const label = (txt: string, x: number, y: number, size = 14, color = "#8a8", w = 220, align: "left" | "center" = "left") => {
    const it = createItem("Label", { x, y });
    it.format = txt; it.style.fontSize = size; it.style.color = color; it.style.align = align; it.rect.w = w;
    return add(it);
  };
  const text = (x: number, y: number, sensor: string | undefined, size: number, color: string, w = 180, align: "left" | "center" = "left") => {
    const it = createItem("SensorText", { x, y });
    it.format = formatForUnit(unitOf(sensor)); it.sensorSrc = sensor;
    it.style.fontSize = size; it.style.color = color; it.style.align = align;
    it.rect.w = w; it.rect.h = size + 8;
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
  const cpuTemp = pick("CPU Package", "Temperature");
  const cpuLoad = pick("CPU Total", "Load");
  const gpuTemp = pick("GPU Core", "Temperature", "NVIDIA");
  const gpuLoad = pick("GPU Core", "Load", "NVIDIA");
  const vram = pick("GPU Memory", "Load", "NVIDIA");
  const dram = pick("Memory", "Load", "Total Memory");
  const cpuPower = pick("CPU Package", "Power");
  const gpuPower = pick("GPU Package", "Power", "NVIDIA");
  const netDown = pickNetwork(sensors.list, ["Download Speed", "download", "ダウンロード"], ["イーサネット", "ethernet"])?.id;
  const netUp = pickNetwork(sensors.list, ["Upload Speed", "upload", "アップロード"], ["イーサネット", "ethernet"])?.id;

  const WARM = "#ffb14e", COOL = "#00d2c4", GREEN = "#6af62a", PINK = "#ff3484";

  // --- CPU（左・大）＋ DRAM（横・小）。縦中央(=270)へ寄せて下の余白を詰める ---
  label("CPU", 50, 64, 22, WARM, 320, "center");
  gaugeModule(50, 110, 320, cpuLoad, cpuTemp, WARM);
  label("DRAM", 400, 120, 18, "#ffd23f", 220, "center");
  gaugeOne(400, 160, 220, dram, "#ffd23f");

  // --- 中央：ネットワーク / 電力 / 時計 ---
  label("NETWORK  ↓ / ↑", 700, 50, 16, COOL);
  const graph = createItem("GraphLine", { x: 700, y: 82 });
  graph.rect.w = 560; graph.rect.h = 230; graph.unit = "Kbps"; graph.autoUnit = true; graph.bgOpacity = 0.25; graph.valueScale = 8; // KB/s→Kbps
  graph.graphStyle = "dual-basic"; graph.style.color = COOL; graph.color2 = PINK;
  graph.sensorSrc = netDown; graph.sensorSrc2 = netUp;
  add(graph);
  label("TOTAL POWER", 700, 338, 16);
  const power = createItem("SensorText", { x: 700, y: 358 });
  power.format = "%d W"; power.style.fontSize = 58; power.style.color = "#ffffff"; power.rect.w = 270; power.rect.h = 66;
  power.sensorSum = [cpuPower, gpuPower].filter(Boolean) as string[];
  add(power);
  const clock = createItem("DateTime", { x: 1010, y: 346 });
  clock.format = "HH:mm:ss"; clock.style.fontSize = 64; clock.style.color = "#eee8d6"; clock.rect.w = 320;
  add(clock);
  const date = createItem("DateTime", { x: 1010, y: 422 });
  date.format = "yyyy-MM-dd"; date.style.fontSize = 24; date.style.color = "#9aa"; date.rect.w = 240;
  add(date);

  // --- VRAM（小）＋ GPU（右・大）。中央列(700-1260)を避け、右マージンを左と対称に ---
  label("VRAM", 1300, 120, 18, "#b07cff", 220, "center");
  gaugeOne(1300, 160, 220, vram, "#b07cff");
  label("GPU", 1550, 64, 22, COOL, 320, "center");
  gaugeModule(1550, 110, 320, gpuLoad, gpuTemp, COOL);

  panel.items = items;
  return panel;
}
