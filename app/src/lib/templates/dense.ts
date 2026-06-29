import { createPanel, createItem, type Panel, type PanelItem } from "$lib/model/panel";
import { sensors } from "$lib/sensors/live.svelte";
import { pickLhm } from "$lib/sensors/match";
import { formatForUnit } from "$lib/render/format";

// 横バーを敷き詰めた高密度テンプレ「Dense」。
// CPU全コア(2列) ＋ GPUエンジン別使用率 ＋ CPU/GPUサマリ を4カラムで並べ、各列を上下いっぱいに詰める。
// コア・エンジン・各センサーは実機（LHM）から検出。
export function buildDenseTemplate(): Panel {
  const panel = createPanel(1920, 480);
  const items: PanelItem[] = [];
  const add = <T extends PanelItem>(it: T): T => { items.push(it); return it; };
  const unitOf = (id?: string) => sensors.list.find((s) => s.id === id)?.unit;
  // LHM：名前完全一致＋型一致（必要ならハード名）で曖昧さを排除
  const pick = (name: string, type: string, hwHas?: string): string | undefined =>
    pickLhm(sensors.list, name, type, hwHas)?.id;

  // パレット
  const LOAD: [string, string] = ["#ffb14e", "#ff3b6b"];   // CPU負荷
  const GLOAD: [string, string] = ["#00d2c4", "#3aa0ff"];  // GPU負荷
  const VRAMC: [string, string] = ["#b07cff", "#ff3484"];
  const TEMP: [string, string] = ["#36d399", "#ff3b6b"];
  const PWR: [string, string] = ["#ffd23f", "#ff8a3b"];
  const CLK: [string, string] = ["#7c9cff", "#3aa0ff"];
  const WARM = "#ffb14e", COOL = "#00d2c4";

  const label = (txt: string, x: number, y: number, size: number, color: string, w: number, align: "left" | "center" | "right" = "left") => {
    const it = createItem("Label", { x, y });
    it.format = txt; it.style.fontSize = size; it.style.color = color; it.style.align = align; it.rect.w = w;
    return add(it);
  };
  const valueText = (x: number, y: number, sensor: string | undefined, size: number, color: string, w: number, range?: [number, number]) => {
    const it = createItem("SensorText", { x, y });
    it.format = formatForUnit(unitOf(sensor)); it.sensorSrc = sensor;
    if (range) it.range = range; // 値の予約桁数をレンジから決める（4桁クロックの桁切れ防止）
    it.style.fontSize = size; it.style.color = color; it.style.align = "right"; it.rect.w = w; it.rect.h = size + 6;
    return add(it);
  };

  const COLW = 462;
  const COLX = [18, 492, 966, 1440];
  const Y0 = 42, YEND = 470; // 各列はこの範囲を均等に埋める
  const header = (ci: number, txt: string, color: string) => label(txt, COLX[ci], 16, 13, color, COLW, "left");

  // 1行（ラベル＋横バー＋値）。slot高さに合わせ縦中央に置く＝列いっぱいに詰めても整う。
  type RowSpec = [title: string, sensor: string | undefined, c: [string, string], range: [number, number], titleColor: string];
  const placeColumn = (colX: number, rows: RowSpec[]) => {
    const n = rows.length;
    if (!n) return;
    const step = (YEND - Y0) / n;
    const barH = Math.min(22, Math.max(11, Math.round(step - 8)));
    rows.forEach(([t, id, c, r, tc], i) => {
      const slotY = Y0 + step * i;
      const barY = Math.round(slotY + (step - barH) / 2);
      const textY = Math.round(slotY + (step - 13) / 2);
      label(t, colX, textY, 11, tc, 92, "left");
      valueText(colX + COLW - 96, textY, id, 12, "#eee8d6", 96, r);
      const b = createItem("BarH", { x: colX + 96, y: barY });
      b.rect.w = COLW - 202; b.rect.h = barH; b.sensorSrc = id; b.range = r;
      b.style.color = c[0]; b.useGradient = true; b.gradColor = c[1];
      b.bgColor = "#161616"; b.bgOpacity = 1; b.frameColor = "#2a2a2a"; b.frameOpacity = 1;
      add(b);
    });
  };

  // --- CPUコア使用率（LHM "CPU Core #N"。負荷にP/E表記は無いのでC1..Cnで並べる）---
  const coreRe = /^CPU Core #(\d+)$/;
  const cores: { id: string; idx: number }[] = [];
  for (const s of sensors.list) {
    if (s.type !== "Load") continue;
    const m = s.name.match(coreRe);
    if (!m) continue;
    cores.push({ id: s.id, idx: Number(m[1]) });
  }
  cores.sort((a, b) => a.idx - b.idx);
  const half = Math.ceil(cores.length / 2);
  const coreRow = (c: { id: string; idx: number }): RowSpec =>
    [`C${c.idx}`, c.id, LOAD, [0, 100], WARM];

  header(0, "CPU CORES", WARM);
  header(1, "CPU CORES", WARM);
  placeColumn(COLX[0], cores.slice(0, half).map(coreRow));
  placeColumn(COLX[1], cores.slice(half).map(coreRow));
  if (!cores.length) label("コア使用率センサーが見つかりません", COLX[0], 120, 18, "#888", 800, "left");

  // --- GPUエンジン別使用率（NVIDIAは物理コア単位を出さないので内部エンジンの使用率を並べる）---
  const seenG = new Set<string>();
  const gpuEngines: { id: string; name: string }[] = [];
  for (const s of sensors.list) {
    if (!/NVIDIA|GeForce/i.test(s.hw)) continue; // dGPU(NVIDIA)のみ
    if (s.type !== "Load" || s.unit !== "%") continue;
    if (seenG.has(s.name)) continue;
    seenG.add(s.name);
    gpuEngines.push({ id: s.id, name: s.name });
  }
  header(2, "GPU ENGINES", COOL);
  placeColumn(COLX[2], gpuEngines.map((g): RowSpec => {
    const short = g.name.replace(/^GPU\s*/, "").trim();
    return [short, g.id, /Memory/.test(g.name) ? VRAMC : GLOAD, [0, 100], "#7fd6cf"];
  }));
  if (!gpuEngines.length) label("GPU使用率センサーが見つかりません", COLX[2], 120, 14, "#888", 400, "left");

  // --- Col3: CPU/GPU サマリ（温度・電力・クロック・電圧・ファン）---
  header(3, "SUMMARY", "#eee8d6");
  placeColumn(COLX[3], [
    ["CPU 総%", pick("CPU Total", "Load"), LOAD, [0, 100], WARM],
    ["RAM %", pick("Memory", "Load", "Total Memory"), LOAD, [0, 100], WARM],
    ["CPU 温度", pick("CPU Package", "Temperature"), TEMP, [0, 100], WARM],
    ["CPU 電力", pick("CPU Package", "Power"), PWR, [0, 250], WARM],
    ["CPU クロック", pick("P-Core #1", "Clock"), CLK, [0, 6000], WARM],
    ["GPU 温度", pick("GPU Core", "Temperature", "NVIDIA"), TEMP, [0, 100], COOL],
    ["GPU MemJct", pick("GPU Memory Junction", "Temperature", "NVIDIA"), TEMP, [0, 110], COOL],
    ["GPU 電力", pick("GPU Package", "Power", "NVIDIA"), PWR, [0, 400], COOL],
    ["GPU コア電圧", pick("GPU Core Voltage", "Voltage", "NVIDIA"), CLK, [0, 1.2], COOL],
    ["GPU クロック", pick("GPU Core", "Clock", "NVIDIA"), CLK, [0, 3500], COOL],
    ["GPU メモクロック", pick("GPU Memory", "Clock", "NVIDIA"), CLK, [0, 16000], COOL],
    ["GPU ファン", pick("GPU Fan 1", "Fan", "NVIDIA"), TEMP, [0, 4000], COOL],
  ]);

  panel.items = items;
  return panel;
}
