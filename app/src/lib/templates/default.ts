import { createPanel, createItem, type Panel, type PanelItem } from "$lib/model/panel";
import { sensors } from "$lib/sensors/live.svelte";
import { pickLhm, pickNetwork } from "$lib/sensors/match";

// 標準テンプレ「Default」。CPU/GPU(丸ゲージ+中心%、温度・メモリ横バー)、ネットワーク線グラフ、
// Claude/Codex の使用量(5h/7d 横バー)＋5hリセットのカウントダウンを1画面に整列して並べる。
// ハードは実機(LHM)から解決、使用量は固定ID(usageイベント)を直接参照。
export function buildDefaultTemplate(): Panel {
  const panel = createPanel(1920, 520);
  const items: PanelItem[] = [];
  const add = <T extends PanelItem>(it: T): T => { items.push(it); return it; };
  const pick = (name: string, type: string, hwHas?: string) => pickLhm(sensors.list, name, type, hwHas)?.id;

  // パレット（色1→色2のグラデ）
  const WARM: [string, string] = ["#ffb14e", "#ff3b6b"];
  const COOL: [string, string] = ["#00d2c4", "#3aa0ff"];
  const TEMP: [string, string] = ["#36d399", "#ff3b6b"];
  const MEM: [string, string] = ["#b07cff", "#ff3484"];
  const CLAUDE: [string, string] = ["#d97757", "#ffb14e"]; // Claudeオレンジ
  const CODEX: [string, string] = ["#10a37f", "#3ad2a0"];  // OpenAIグリーン
  const WARMC = "#ffb14e", COOLC = "#00d2c4", INK = "#eee8d6";
  const FONT = "夜永オールド明朝 Bold"; // 夜永 Bold。ja-JP環境のピッカーが返す日本語ファミリ名（英名"Yonaga Old Mincho Bold"では一致しない）

  const label = (txt: string, x: number, y: number, size: number, color: string, w: number, align: "left" | "center" | "right" = "left") => {
    const it = createItem("Label", { x, y });
    it.format = txt; it.style.fontSize = size; it.style.color = color; it.style.align = align; it.rect.w = w; it.rect.h = size + 6;
    add(it);
  };

  // 丸ゲージ＋中心に%（負荷系）。title を上に添える。
  const gauge = (x: number, top: number, size: number, sensor: string | undefined, grad: [string, string], title: string, titleColor: string) => {
    label(title, x, top, 20, titleColor, size, "center");
    const gy = top + 26;
    const g = createItem("Gauge", { x, y: gy });
    g.rect.w = size; g.rect.h = size; g.sensorSrc = sensor; g.range = [0, 100]; g.format = "%d";
    g.style.color = grad[0]; g.useGradient = true; g.gradColor = grad[1]; // 2色ラジアルグラデ
    add(g);
    const t = createItem("SensorText", { x, y: Math.round(gy + size * 0.36) });
    t.sensorSrc = sensor; t.format = "%d%"; t.style.fontSize = Math.round(size * 0.26);
    t.style.color = INK; t.style.align = "center"; t.rect.w = size; t.rect.h = Math.round(size * 0.32);
    add(t);
  };

  // ラベル＋横バー＋右寄せ値。labelW でラベル欄幅を可変（使用量は長いので広め）。
  const bar = (x: number, y: number, w: number, title: string, sensor: string | undefined, range: [number, number], c: [string, string], valueFmt: string, titleColor = "#cbb8a6", labelW = 60) => {
    label(title, x, y + 3, 14, titleColor, labelW - 2, "left");
    const bx = x + labelW + 2;
    const b = createItem("BarH", { x: bx, y });
    b.rect.w = w - (labelW + 2) - 62; b.rect.h = 20; b.sensorSrc = sensor; b.range = range;
    b.style.color = c[0]; b.useGradient = true; b.gradColor = c[1];
    b.bgColor = "#161616"; b.bgOpacity = 1; b.frameColor = "#2a2a2a"; b.frameOpacity = 1;
    add(b);
    const v = createItem("SensorText", { x: x + w - 60, y: y + 3 });
    v.sensorSrc = sensor; v.format = valueFmt; v.style.fontSize = 14; v.style.color = INK; v.style.align = "right"; v.rect.w = 60; v.rect.h = 20;
    add(v);
  };

  // ラベル＋リセットまでの残り時間カウントダウン。
  const resetRow = (x: number, y: number, w: number, title: string, sensor: string, color: string, labelW = 60) => {
    label(title, x, y + 3, 14, color, labelW - 2, "left");
    const t = createItem("SensorText", { x: x + labelW + 2, y: y + 2 });
    t.sensorSrc = sensor; t.format = "残り %t"; t.style.fontSize = 15; t.style.color = INK; t.style.align = "left"; t.rect.w = w - (labelW + 2); t.rect.h = 22;
    add(t);
  };

  // --- センサー束縛（実機） ---
  const cpuLoad = pick("CPU Total", "Load");
  const cpuTemp = pick("CPU Package", "Temperature");
  const ram = pick("Memory", "Load", "Total Memory");
  const gpuLoad = pick("GPU Core", "Load", "NVIDIA");
  const gpuTemp = pick("GPU Core", "Temperature", "NVIDIA");
  const vram = pick("GPU Memory", "Load", "NVIDIA");
  const netDown = pickNetwork(sensors.list, ["Download Speed", "download", "ダウンロード"], ["イーサネット", "ethernet"])?.id;
  const netUp = pickNetwork(sensors.list, ["Upload Speed", "upload", "アップロード"], ["イーサネット", "ethernet"])?.id;
  // 使用量は固定ID（usageイベント）を直接参照
  const CU = (n: string) => `Claude|${n}|Usage`, CR = (n: string) => `Claude|${n}|Reset`;
  const XU = (n: string) => `Codex|${n}|Usage`, XR = (n: string) => `Codex|${n}|Reset`;

  // --- 上段: CPU（左）/ ネットワーク（中）/ GPU（右） ---
  gauge(215, 24, 170, cpuLoad, WARM, "CPU", WARMC); // バー列(60..540)中心=300
  bar(60, 236, 480, "温度", cpuTemp, [0, 100], TEMP, "%d°C");
  bar(60, 268, 480, "RAM", ram, [0, 100], MEM, "%d%");

  gauge(1535, 24, 170, gpuLoad, COOL, "GPU", COOLC); // バー列(1380..1860)中心=1620
  bar(1380, 236, 480, "温度", gpuTemp, [0, 100], TEMP, "%d°C");
  bar(1380, 268, 480, "VRAM", vram, [0, 100], MEM, "%d%");

  label("NETWORK  ↓ / ↑", 600, 24, 17, COOLC, 720, "left");
  const graph = createItem("GraphLine", { x: 600, y: 50 });
  graph.rect.w = 720; graph.rect.h = 238; graph.unit = "Kbps"; graph.autoUnit = true; graph.valueScale = 8; // KB/s→Kbps
  graph.graphStyle = "dual-basic"; graph.style.color = COOL[0]; graph.color2 = "#ff3484";
  graph.sensorSrc = netDown; graph.sensorSrc2 = netUp; graph.bgOpacity = 0.25;
  add(graph);

  // 仕切り
  const div = createItem("Line", { x: 60, y: 302 });
  div.rect.w = 1800; div.rect.h = 2; div.style.color = "#333"; div.lineWidth = 1; add(div);

  // --- 下段: Claude（左）/ Codex（右） ---
  label("Claude", 60, 312, 20, CLAUDE[0], 860, "left");
  bar(60, 346, 860, "5h 使用率", CU("5h 使用率"), [0, 100], CLAUDE, "%d%", CLAUDE[0], 100);
  bar(60, 380, 860, "7d 使用率", CU("7d 使用率"), [0, 100], CLAUDE, "%d%", CLAUDE[0], 100);
  resetRow(60, 414, 860, "5h リセット", CR("5h リセット"), CLAUDE[0], 100);

  // Codex(plusプラン)は7d枠のみ＝5h枠は存在しない。実在する枠だけ置く。
  label("Codex", 1000, 312, 20, CODEX[0], 860, "left");
  bar(1000, 346, 860, "7d 使用率", XU("7d 使用率"), [0, 100], CODEX, "%d%", CODEX[0], 100);
  resetRow(1000, 380, 860, "7d リセット", XR("7d リセット"), CODEX[0], 100);

  // --- 承認待ち（Claude/Codexが承認プロンプトで止まってる件数＋どのフォルダか）。各セクションの下に分けて置く ---
  const ALERT = "#ff8a5b", RUN = "#5fd6c8";
  const alertBlock = (x: number, y: number, w: number, provider: string, runId: string, waitId: string) => {
    const run = createItem("SensorText", { x, y });
    run.sensorSrc = runId; run.format = "実行中 %d"; run.style.fontSize = 14; run.style.color = RUN; run.style.align = "left"; run.rect.w = 110; run.rect.h = 18; add(run);
    const wait = createItem("SensorText", { x: x + 130, y });
    wait.sensorSrc = waitId; wait.format = "承認待ち %d"; wait.style.fontSize = 14; wait.style.color = ALERT; wait.style.align = "left"; wait.rect.w = 130; wait.rect.h = 18; add(wait);
    const al = createItem("AlertList", { x, y: y + 22 }); // 承認待ちフォルダ一覧
    al.rect.w = w; al.rect.h = 44; al.sensorSrc = provider; al.style.fontSize = 13; al.style.color = ALERT; add(al);
  };
  alertBlock(60, 446, 860, "claude", "Claude|実行中|Alert", "Claude|承認待ち|Alert"); // Claude列の下（左）
  alertBlock(1000, 446, 860, "codex", "Codex|実行中|Alert", "Codex|承認待ち|Alert"); // Codex列の下（右）＝同じ高さ

  // 全テキストのフォントを夜永 Bold に統一（テキスト以外のitemに入っても無害）
  for (const it of items) it.style.fontFamily = FONT;
  panel.items = items;
  return panel;
}
