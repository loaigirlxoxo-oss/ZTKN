import { createPanel, createItem, type Panel, type PanelItem } from "$lib/model/panel";
import { sensors } from "$lib/sensors/live.svelte";
import { pickLhm, pickNetwork } from "$lib/sensors/match";

// 「AIDA Monitor（監視パンク）」テンプレ。1920×480。
// primary ポスター(スクリーンプリント/グランジ)に合わせた設計 =「刷り物の文法でデータを組む」。
// 丸ゲージ(ゲーマーHUD記号)は使わず、① 特大タイポの数字(温度) ② 印刷モチーフのフラットバー
// (barcode/ticket-strip の16連番スプライト) ③ 折れ線1本(ネットワーク) で構成。
// 背景のカオスに対し、データは暗い破れプレート＋厳格グリッドで"整然クリーン"に載せて対比させる。
//
// 注意: 背景と印刷バーのスプライトは、このリポジトリの Assets 実体を絶対パスで参照する（この開発機向け）。
// センサーは実機(LHM)から pick で解決。ハード内容は Default テンプレと同じ(CPU/GPU/RAM/VRAM/ネット/時計)。
const ASSET = "D:/VSCode/PCStatus-editor-phase1/app/Assets/aida64-skin-release-full";
const BG = `${ASSET}/backgrounds/background-primary-1920x480.png`;
// 横印刷バーの16連番(state-01..16)を絶対パス配列で返す。
const hbar = (style: string, color: string): string[] =>
  Array.from({ length: 16 }, (_, i) => `${ASSET}/custom-gauges-horizontal/${style}/${color}/state-${String(i + 1).padStart(2, "0")}.png`);

export function buildAidaMonitorTemplate(): Panel {
  const panel = createPanel(1920, 480);
  panel.background = BG;
  const items: PanelItem[] = [];
  const add = <T extends PanelItem>(it: T): T => { items.push(it); return it; };
  const pick = (name: string, type: string, hwHas?: string) => pickLhm(sensors.list, name, type, hwHas)?.id;

  // ポスターのパレット
  const TEAL = "#00d2c4", PINK = "#ff3484", LIME = "#a3e635", INK = "#eee8d6", SUB = "#8aa0a2";
  const FONT = "Bahnschrift"; // Windows内蔵のDIN系。刷り物の上は"太くクリーンな工業書体"が最も読める

  // 暗い破れプレート（読める領域を彫り出す。秩序×混沌）
  const plate = (x: number, y: number, w: number, h: number) => {
    const b = createItem("Box", { x, y }); b.rect.w = w; b.rect.h = h;
    b.bgColor = "#050608"; b.bgOpacity = 0.62; b.frameColor = TEAL; b.frameOpacity = 0.3; b.borderWidth = 1; b.cornerRadius = 8; add(b);
  };
  const label = (txt: string, x: number, y: number, size: number, color: string, w: number, align: "left" | "center" | "right" = "left", weight: "normal" | "bold" = "normal") => {
    const it = createItem("Label", { x, y }); it.format = txt; it.style.fontSize = size; it.style.color = color; it.style.align = align; it.style.fontWeight = weight; it.rect.w = w; it.rect.h = size + 6; add(it);
  };
  // 特大の数値（主役）。
  const bignum = (x: number, y: number, w: number, size: number, sensor: string | undefined, fmt: string, color = INK, align: "left" | "right" | "center" = "left") => {
    const t = createItem("SensorText", { x, y }); t.sensorSrc = sensor; t.format = fmt; t.style.fontSize = size; t.style.fontWeight = "bold"; t.style.color = color; t.style.align = align; t.rect.w = w; t.rect.h = size + 10; add(t);
  };
  // 印刷モチーフの横バー（StateFrames 連番スプライト）。値で連番が切り替わる。
  const printBar = (x: number, y: number, w: number, h: number, sensor: string | undefined, style: string, color: string) => {
    const g = createItem("Gauge", { x, y }); g.rect.w = w; g.rect.h = h; g.sensorSrc = sensor; g.range = [0, 100];
    g.gauge = { mode: "StateFrames", frames: hbar(style, color) };
    g.bgOpacity = 0; g.frameOpacity = 0; add(g);
  };

  // --- センサー束縛（実機・Default と同じ） ---
  const cpuLoad = pick("CPU Total", "Load");
  const cpuTemp = pick("CPU Package", "Temperature");
  const ram = pick("Memory", "Load", "Total Memory");
  const gpuLoad = pick("GPU Core", "Load", "NVIDIA");
  const gpuTemp = pick("GPU Core", "Temperature", "NVIDIA");
  const vram = pick("GPU Memory", "Load", "NVIDIA");
  const netDown = pickNetwork(sensors.list, ["Download Speed", "download", "ダウンロード"], ["イーサネット", "ethernet"])?.id;
  const netUp = pickNetwork(sensors.list, ["Upload Speed", "upload", "アップロード"], ["イーサネット", "ethernet"])?.id;

  // === 下帯にデータ（上半分はポスターの絵を活かす） ===

  // 左: CPU（特大温度＋印刷バーで負荷）
  plate(56, 330, 372, 130);
  label("CPU", 82, 340, 16, TEAL, 200, "left", "bold");
  bignum(76, 352, 240, 84, cpuTemp, "%d°", INK, "left");
  label("LOAD", 82, 438, 12, SUB, 60, "left");
  printBar(140, 438, 240, 12, cpuLoad, "barcode", "cyan");
  bignum(330, 432, 66, 20, cpuLoad, "%d%", TEAL, "right");

  // 右: GPU（特大温度＋印刷バー）＋時計
  plate(1492, 330, 372, 130);
  label("GPU", 1516, 340, 16, TEAL, 200, "left", "bold");
  bignum(1510, 352, 240, 84, gpuTemp, "%d°", INK, "left");
  label("LOAD", 1516, 438, 12, SUB, 60, "left");
  printBar(1574, 438, 226, 12, gpuLoad, "barcode", "pink");
  bignum(1748, 432, 60, 20, gpuLoad, "%d%", TEAL, "right");
  const clock = createItem("DateTime", { x: 1690, y: 340 });
  clock.format = "HH:mm:ss"; clock.style.fontSize = 24; clock.style.fontWeight = "bold"; clock.style.color = INK; clock.style.align = "right"; clock.rect.w = 156; clock.rect.h = 30; add(clock);

  // 中央: NETWORK（折れ線1本＝唯一動く要素）
  plate(760, 344, 560, 116);
  label("NETWORK  ↓ / ↑", 782, 352, 15, TEAL, 300, "left", "bold");
  const graph = createItem("GraphLine", { x: 782, y: 376 });
  graph.rect.w = 516; graph.rect.h = 68; graph.unit = "Mbps"; graph.autoUnit = true; graph.valueScale = 8; // KB/s→Kbps系(自動換算)
  graph.graphStyle = "dual-basic"; graph.style.color = TEAL; graph.color2 = PINK; graph.sensorSrc = netDown; graph.sensorSrc2 = netUp; graph.bgOpacity = 0; add(graph);

  // 中左のすき間: VRAM / RAM（小さめの数字＋ticket-stripの細バー）
  label("VRAM", 470, 356, 13, SUB, 80, "left");
  bignum(468, 368, 96, 36, vram, "%d", INK, "left");
  label("%", 556, 386, 16, SUB, 20, "left");
  printBar(470, 402, 156, 10, vram, "ticket-strip", "lime");
  label("RAM", 470, 418, 13, SUB, 80, "left");
  bignum(468, 430, 96, 36, ram, "%d", INK, "left");
  label("%", 556, 448, 16, SUB, 20, "left");
  printBar(470, 388 + 76, 156, 10, ram, "ticket-strip", "cream"); // RAM=cream(生成り)

  // 全テキストのフォントを工業書体に統一
  for (const it of items) it.style.fontFamily = FONT;
  panel.items = items;
  return panel;
}
