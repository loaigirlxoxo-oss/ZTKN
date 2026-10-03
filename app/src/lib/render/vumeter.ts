// アナログVUメーター。枠・紙・ガラスの質感は生成画像、幾何（目盛・針・影）は線で描く。
// 生成側に厳密な座標を要求するとコード描画に落ちるため、分担をこう切ってある。
// 汚れと割れも生成画像（灰色の背景から透明度を作った透過PNG）。
//
// 重ね順: 紙 → 目盛 → 針 → ランプ → 枠の影 → 汚れ → 割れ → ガラス → 枠
// 枠は窓の外側だけにクリップして重ねるので、枠画像を加工せずに済む。

export interface VuVariant {
  id: string;
  label: string;
  /** 枠画像の実寸。窓はこの座標系で測ってある。 */
  panel: [number, number];
  window: { left: number; top: number; width: number; height: number };
  /** 支点と弧。窓の座標系。 */
  pivotY: number;
  radius: number;
  /** 目盛の色。黒い文字板の国では明るい色になる。 */
  ink: string;
  red: string;
  /** 照明（電球）の色。暗い色ほど光が弱くなる。 */
  lamp: string;
  /** 針の色。黒い文字板では明るくしないと見えない。 */
  needle: string;
  /** 種類を切り替えたときに当てる初期値。新品に割れが入って見えないように。 */
  defaults: Partial<Pick<VuSettings, "lamp" | "glass" | "grime" | "cracks" | "shadow">>;
  /** 文字板の様式（目盛の割り付け・数字・書体）。国ごとに違う。 */
  dial: "ussr" | "us" | "jp";
  /** 文字板の表記。 */
  title: string;
  chL: string;
  chR: string;
  /** grime と crack は透過PNG（tools/build-vu-overlays.py）。国ごとに別の絵。 */
  src: { bezel: string; paper: string; glass: string; grime: string; crack: string };
}

export const VU_VARIANTS: Record<string, VuVariant> = {
  ussr: {
    id: "ussr",
    label: "ソ連製（経年）",
    panel: [2048, 756],
    window: { left: 95, top: 80, width: 1873, height: 597 },
    pivotY: 650,
    radius: 527.4,
    ink: "#241d14",
    red: "#a3231b",
    lamp: "224,150,78",   // 豆電球の暖色。明るさも抑えてある
    needle: "#15110c",
    // 割れと映り込みは白の加算なので、強いと豆電球の暖色を打ち消す。控えめにしてある。
    defaults: { glass: 0.09, grime: 0.45, cracks: 0.35, shadow: 0.45, lamp: 0.55 },
    dial: "ussr",
    title: "УРОВЕНЬ",
    chL: "Л",
    chR: "П",
    src: { bezel: "/vu/ussr/bezel.png", paper: "/vu/ussr/paper.png", glass: "/vu/ussr/glass.png", grime: "/vu/overlays/su-grime.png", crack: "/vu/overlays/su-crack.png" },
  },
  // 以下は tools/build-vu-assets.py の出力（窓・支点・半径）。素材は tmp-textures/v11-*（imagegen 無加工）。
  // 日本製は黒い文字板なので目盛と針を明るく。ランプの青は Sansui 9090DB の青いメーターが手本（未確定）。
  "us": {
    id: "us",
    label: "アメリカ製（新品）",
    panel: [1642, 617],
    window: { left: 132, top: 117, width: 1377, height: 367 },
    pivotY: 457,
    radius: 298,
    ink: "#1c1712",
    red: "#b3261e",
    lamp: "255,206,132",
    needle: "#15110c",
    defaults: { glass: 0.12, grime: 0.0, cracks: 0.0, shadow: 0.45, lamp: 0.55 },
    dial: "us",
    title: "VU",
    chL: "L",
    chR: "R",
    src: { bezel: "/vu/us/bezel.png", paper: "/vu/us/paper.png", glass: "/vu/us/glass.png", grime: "/vu/overlays/us-grime.png", crack: "/vu/overlays/us-crack.png" },
  },
  "us-aged": {
    id: "us-aged",
    label: "アメリカ製（経年）",
    panel: [1643, 658],
    window: { left: 159, top: 134, width: 1326, height: 381 },
    pivotY: 488,
    radius: 311.1,
    ink: "#1c1712",
    red: "#b3261e",
    lamp: "255,206,132",
    needle: "#15110c",
    defaults: { glass: 0.16, grime: 0.45, cracks: 0.0, shadow: 0.45, lamp: 0.55 },
    dial: "us",
    title: "VU",
    chL: "L",
    chR: "R",
    src: { bezel: "/vu/us-aged/bezel.png", paper: "/vu/us-aged/paper.png", glass: "/vu/us-aged/glass.png", grime: "/vu/overlays/us-grime.png", crack: "/vu/overlays/us-crack.png" },
  },
  "jp": {
    id: "jp",
    label: "日本製（新品）",
    panel: [1641, 592],
    // 窓は枠の開口（150,114 1341x355）より広げてある。開口のままだと枠に対して文字板が小さい。
    window: { left: 105, top: 60, width: 1431, height: 472 },
    pivotY: 505,
    radius: 392,
    ink: "#ece6d6",
    red: "#ff5a36",
    lamp: "140,190,255",
    needle: "#f2ece0",
    defaults: { glass: 0.12, grime: 0.0, cracks: 0.0, shadow: 0.45, lamp: 0.55 },
    dial: "jp",
    title: "VU",
    chL: "L",
    chR: "R",
    src: { bezel: "/vu/jp/bezel.png", paper: "/vu/jp/paper.png", glass: "/vu/jp/glass.png", grime: "/vu/overlays/jp-grime.png", crack: "/vu/overlays/jp-scuff.png" },
  },
  "jp-aged": {
    id: "jp-aged",
    label: "日本製（経年）",
    panel: [1672, 617],
    // 窓は枠の開口（192,142 1288x339）より広げてある。
    window: { left: 115, top: 62, width: 1442, height: 493 },
    pivotY: 528,
    radius: 406,
    ink: "#ece6d6",
    red: "#ff5a36",
    lamp: "140,190,255",
    needle: "#f2ece0",
    defaults: { glass: 0.16, grime: 0.45, cracks: 0.0, shadow: 0.45, lamp: 0.55 },
    dial: "jp",
    title: "VU",
    chL: "L",
    chR: "R",
    src: { bezel: "/vu/jp-aged/bezel.png", paper: "/vu/jp-aged/paper.png", glass: "/vu/jp-aged/glass.png", grime: "/vu/overlays/jp-grime.png", crack: "/vu/overlays/jp-scuff.png" },
  },
};

export interface VuSettings {
  variant: string;
  lamp: number;    // バックライトの強さ
  glass: number;   // ガラスの映り込み
  grime: number;   // 汚れ
  cracks: number;  // 割れ
  shadow: number;  // 枠の影
  weight: number;  // 針の重さ（1.0 = VU規格の300ms）
  refDb: number;   // 0VU とみなす dBFS。-18 が既定
  label: boolean;  // 文字板の表記を描くか
}

export const VU_DEFAULTS: VuSettings = {
  variant: "ussr",
  lamp: 0.55, glass: 0.09, grime: 0.45, cracks: 0.35, shadow: 0.45,
  weight: 1, refDb: -18, label: true,
};

// ---- 目盛の割り付け ----
// VU の目盛は電圧比例。-20..+3VU を 0..1 に写す。
const FULL = Math.pow(10, 3 / 20);
export const posOf = (db: number): number => Math.pow(10, db / 20) / FULL;
const TICKS = [-20, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3];
const NUMS: Record<string, string> = { "-20": "20", "-10": "10", "-5": "5", "-3": "3", "0": "0", "3": "+3" };
const PCT = [0, 20, 40, 60, 80, 100];
const A0 = (-49 * Math.PI) / 180;
const A1 = (49 * Math.PI) / 180;
const angOf = (p: number): number => A0 + (A1 - A0) * Math.min(1, Math.max(0, p));

/** RMS振幅を VU の針位置(0..1)へ。refDb を 0VU とみなす。 */
export function rmsToPos(rms: number, refDb: number): number {
  if (!(rms > 1e-7)) return 0;
  const db = 20 * Math.log10(rms) - refDb;
  return Math.min(1.08, posOf(db));
}

/** 針のバリスティクス。VU規格の 300ms / 行き過ぎ1.2% を満たす係数。 */
export class Ballistics {
  p = 0;
  private v = 0;
  private lastTick = -1;
  /** sceneFunc は1フレームに複数回呼ばれうるので、同じ時刻では一度しか進めない。 */
  step(target: number, weight: number, now: number): number {
    if (now === this.lastTick) return this.p;
    this.lastTick = now;
    const k = 0.04 / weight;
    const d = 0.3 / Math.sqrt(weight);
    this.v += (target - this.p) * k - this.v * d;
    this.p += this.v;
    if (this.p < 0) { this.p = 0; this.v = 0; }
    return this.p;
  }
}

type Ctx = CanvasRenderingContext2D;

/** 文字板ごとの支点。左右2枚。 */
function pivots(v: VuVariant): { x: number; y: number }[] {
  const dw = v.window.width / 2;
  return [
    { x: v.window.left + dw * 0.5, y: v.pivotY },
    { x: v.window.left + dw * 1.5, y: v.pivotY },
  ];
}

/** 目盛を静的なキャンバスへ焼く。毎フレーム描き直す必要はない。 */
export function buildScale(v: VuVariant): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = v.panel[0];
  c.height = v.panel[1];
  const x = c.getContext("2d")!;
  for (const pv of pivots(v)) DIALS[v.dial].scale(x, v, pv);
  return c;
}

type Pt = { x: number; y: number };

/** 文字板の様式。国ごとに目盛の割り付け・数字・赤の入れ方・書体が違う。 */
interface Dial {
  scale(x: Ctx, v: VuVariant, pv: Pt): void;
  /** 文字板の表記（題字・チャンネル）。 */
  label(g: Ctx, v: VuVariant, pv: Pt, ch: string): void;
}

/** 弧上の点。p は 0..1 の針位置、rad は支点からの距離。 */
function arcPt(pv: Pt, p: number, rad: number): [number, number] {
  const a = angOf(p) - Math.PI / 2;
  return [pv.x + Math.cos(a) * rad, pv.y + Math.sin(a) * rad];
}

function arcStroke(x: Ctx, pv: Pt, rad: number, p0: number, p1: number, color: string, width: number): void {
  x.strokeStyle = color; x.lineWidth = width; x.lineCap = "butt";
  x.beginPath(); x.arc(pv.x, pv.y, rad, angOf(p0) - Math.PI / 2, angOf(p1) - Math.PI / 2); x.stroke();
}

function tick(x: Ctx, pv: Pt, p: number, r0: number, r1: number, color: string, width: number, cap: CanvasLineCap = "butt"): void {
  const [ax, ay] = arcPt(pv, p, r0);
  const [bx, by] = arcPt(pv, p, r1);
  x.strokeStyle = color; x.lineWidth = width; x.lineCap = cap;
  x.beginPath(); x.moveTo(ax, ay); x.lineTo(bx, by); x.stroke();
}

function text(x: Ctx, s: string, at: [number, number], color: string, font: string): void {
  x.fillStyle = color; x.font = font; x.textAlign = "center"; x.textBaseline = "middle";
  x.fillText(s, at[0], at[1]);
}

const US_FONT = `"Bahnschrift SemiCondensed", "Bahnschrift", "Noto Sans", sans-serif`;
const JP_FONT = `"Segoe UI", "Noto Sans", sans-serif`;

const DIALS: Record<VuVariant["dial"], Dial> = {
  // ソ連製: 目盛線は内向き、数字は弧の内側。赤は弧を太くするだけ。内側に%目盛。
  ussr: {
    scale(x, v, pv) {
      const r = v.radius;
      const p0 = posOf(0);
      arcStroke(x, pv, r, 0, p0, v.ink, r * 0.0095);
      arcStroke(x, pv, r, p0, 1, v.red, r * 0.017);
      // 目盛線は内向き。弧の頂点が窓の上端に近く、外向きだと数字が枠に食われる。
      const TL = r * 0.058;
      for (const db of TICKS) {
        const p = posOf(db);
        const col = db >= 0 ? v.red : v.ink;
        tick(x, pv, p, r, r - TL, col, r * 0.0125, "round");
        const lbl = NUMS[String(db)];
        if (lbl) text(x, lbl, arcPt(pv, p, r - TL - r * 0.052), col, `700 ${Math.round(r * 0.055)}px "Noto Sans", sans-serif`);
      }
      // 内側のパーセント目盛。0% が弧の左端、100% が 0VU。実機と同じ割り付け。
      const r2 = r * 0.78, TL2 = r * 0.04;
      arcStroke(x, pv, r2, 0, p0, v.ink, r * 0.0065);
      for (const val of PCT) {
        const p = val / (100 * FULL);
        tick(x, pv, p, r2, r2 - TL2, v.ink, r * 0.0085, "round");
        text(x, String(val), arcPt(pv, p, r2 - TL2 - r * 0.04), v.ink, `500 ${Math.round(r * 0.04)}px "Noto Sans", sans-serif`);
      }
      x.fillStyle = v.ink;
      x.beginPath(); x.arc(pv.x, pv.y, r * 0.034, 0, Math.PI * 2); x.fill();
    },
    label(g, v, pv, ch) {
      const r = v.radius;
      text(g, v.title, [pv.x, pv.y - r * 0.53], v.ink, `700 ${Math.round(r * 0.075)}px "Noto Sans", sans-serif`);
      text(g, ch, [pv.x - r * 0.615, pv.y - r * 0.4], v.ink, `500 ${Math.round(r * 0.062)}px "Noto Sans", sans-serif`);
    },
  },

  // アメリカ製: ASA C16.5-1954 の「A目盛」。dB を弧の上、% を弧の下。
  // 0〜+3 は弧に乗る太い赤帯。数字は符号なしで 20〜1 を振り、両端に − と +。中央に大きな VU。
  us: {
    scale(x, v, pv) {
      const r = v.radius;
      const p0 = posOf(0);
      const num = `600 ${Math.round(r * 0.06)}px ${US_FONT}`;
      arcStroke(x, pv, r, 0, 1, v.ink, r * 0.008);
      arcStroke(x, pv, r + r * 0.02, p0, 1, v.red, r * 0.04);
      for (const db of TICKS) {
        const p = posOf(db);
        const col = db >= 0 ? v.red : v.ink;
        tick(x, pv, p, r - r * 0.035, r + r * 0.05, col, r * 0.009);   // 弧をまたいで上へ
        text(x, String(Math.abs(db)), arcPt(pv, p, r + r * 0.095), col, num);
      }
      for (const db of [-15, -8, -6, -4, -2.5, -1.5, -0.5, 0.5, 1.5, 2.5]) {
        tick(x, pv, posOf(db), r, r + r * 0.03, db >= 0 ? v.red : v.ink, r * 0.005);
      }
      const sign = `600 ${Math.round(r * 0.1)}px ${US_FONT}`;
      text(x, "−", arcPt(pv, -0.02, r + r * 0.095), v.ink, sign);
      text(x, "+", arcPt(pv, 1.02, r + r * 0.095), v.red, sign);
      // % は弧の下。10 刻みの目盛と 20 刻みの数字。
      for (let val = 0; val <= 100; val += 10) {
        const major = val % 20 === 0;
        const p = val / (100 * FULL);
        tick(x, pv, p, r, r - r * (major ? 0.05 : 0.03), v.ink, r * (major ? 0.008 : 0.005));
        if (major) text(x, String(val), arcPt(pv, p, r - r * 0.1), v.ink, `500 ${Math.round(r * 0.045)}px ${US_FONT}`);
      }
      // 支点は文字板の下に隠れ、黒い半円の覆いだけが見える。
      x.fillStyle = v.ink;
      x.beginPath(); x.arc(pv.x, pv.y, r * 0.06, Math.PI, 0); x.fill();
    },
    label(g, v, pv, ch) {
      const r = v.radius;
      text(g, v.title, [pv.x, pv.y - r * 0.36], v.ink, `700 ${Math.round(r * 0.16)}px ${US_FONT}`);
      text(g, ch, [pv.x - r * 0.7, pv.y - r * 0.12], v.ink, `500 ${Math.round(r * 0.05)}px ${US_FONT}`);
    },
  },

  // 日本製: 1970年代のオーディオ機器。黒い文字板に白の細い目盛、符号つきの数字。
  // 赤は 0〜+3 の区間を弧の内側に塗った帯。%目盛は無く、題字は小さな「VU」。
  jp: {
    scale(x, v, pv) {
      const r = v.radius;
      const p0 = posOf(0);
      const num = `400 ${Math.round(r * 0.055)}px ${JP_FONT}`;
      arcStroke(x, pv, r, 0, p0, v.ink, r * 0.006);
      arcStroke(x, pv, r - r * 0.03, p0, 1, v.red, r * 0.06);
      for (const db of TICKS) {
        const p = posOf(db);
        const col = db >= 0 ? v.red : v.ink;
        tick(x, pv, p, r, r + r * 0.045, col, r * 0.007);              // 細く外向き
        if (db === -2) continue;                                        // 詰まるので数字は振らない
        text(x, db > 0 ? `+${db}` : String(db), arcPt(pv, p, r + r * 0.095), col, num);
      }
      for (let db = -18; db < -10; db += 2) tick(x, pv, posOf(db), r, r + r * 0.025, v.ink, r * 0.004);
      x.fillStyle = v.ink;
      x.beginPath(); x.arc(pv.x, pv.y, r * 0.025, 0, Math.PI * 2); x.fill();
    },
    label(g, v, pv, ch) {
      const r = v.radius;
      text(g, v.title, [pv.x, pv.y - r * 0.5], v.ink, `400 ${Math.round(r * 0.075)}px ${JP_FONT}`);
      text(g, ch, [pv.x + r * 0.62, pv.y - r * 0.12], v.ink, `400 ${Math.round(r * 0.045)}px ${JP_FONT}`);
    },
  },
};

// キーは素材・種類・強さだけでよい。スライダーで強さを変えるたびに増えるので上限を設ける。
const gradCache = new Map<string, CanvasGradient>();
function memoGrad(key: string, make: () => CanvasGradient): CanvasGradient {
  let gr = gradCache.get(key);
  if (!gr) {
    if (gradCache.size >= 64) gradCache.clear();
    gr = make();
    gradCache.set(key, gr);
  }
  return gr;
}

/** 枠が文字板に落とす影。光源は左上なので上と左が濃い。 */
function drawShadow(g: Ctx, v: VuVariant, al: number): void {
  const w = v.window;
  const L = w.left, T = w.top, Rr = L + w.width, B = T + w.height;
  const d1 = Math.round(w.height * 0.105), d2 = Math.round(w.height * 0.052);
  const band = (side: string, bx: number, by: number, bw: number, bh: number,
                x0: number, y0: number, x1: number, y1: number, a: number) => {
    if (bw <= 0 || bh <= 0) return;
    g.fillStyle = memoGrad(`${v.id}|shadow|${side}|${a}`, () => {
      const lg = g.createLinearGradient(x0, y0, x1, y1);
      lg.addColorStop(0, `rgba(10,7,4,${a})`);
      lg.addColorStop(0.3, `rgba(10,7,4,${a * 0.42})`);
      lg.addColorStop(0.64, `rgba(10,7,4,${a * 0.13})`);
      lg.addColorStop(1, "rgba(10,7,4,0)");
      return lg;
    });
    g.fillRect(bx, by, bw, bh);
  };
  band("top", L, T, w.width, d1, L, T, L, T + d1, 0.5 * al);
  band("left", L, T, d1, w.height, L, T, L + d1, T, 0.42 * al);
  band("bottom", L, B - d2, w.width, d2, L, B, L, B - d2, 0.24 * al);
  band("right", Rr - d2, T, d2, w.height, Rr, T, Rr - d2, T, 0.2 * al);
  // 開口のすぐ内側の濃い線。これが無いと影が段差に見えない。
  g.strokeStyle = `rgba(8,5,3,${0.38 * al})`;
  g.lineWidth = 3;
  g.strokeRect(L + 1.5, T + 1.5, w.width - 3, w.height - 3);
  const bh2 = Math.round(d2 * 0.6);
  g.fillStyle = memoGrad(`${v.id}|bounce|${al}`, () => {
    const bl = g.createLinearGradient(L, B, L, B - bh2);
    bl.addColorStop(0, `rgba(255,228,186,${0.055 * al})`);
    bl.addColorStop(1, "rgba(255,228,186,0)");
    return bl;
  });
  g.fillRect(L, B - bh2, w.width, bh2);
}

export interface VuLayers {
  bezel: HTMLImageElement;
  paper: HTMLImageElement;
  glass: HTMLImageElement;
  scale: HTMLCanvasElement;
  cracks: HTMLImageElement;
  grime: HTMLImageElement;
}

/** パネル座標系(variant.panel)で1フレーム描く。呼び出し側で部品の矩形へスケールする。 */
export function drawVu(g: Ctx, v: VuVariant, L: VuLayers, s: VuSettings, pos: [number, number]): void {
  const w = v.window;
  g.save();
  g.beginPath(); g.rect(w.left, w.top, w.width, w.height); g.clip();

  g.drawImage(L.paper, w.left, w.top, w.width, w.height);   // 1. 紙
  g.drawImage(L.scale, 0, 0);                                // 2. 目盛

  if (s.label) {                                             // 2b. 表記
    // 画像生成はキリル文字を全て ? に化けさせるので、ここで描く。
    const r = v.radius;
    pivots(v).forEach((pv, i) => {
      g.save();
      g.globalAlpha = 0.88;
      DIALS[v.dial].label(g, v, pv, i ? v.chR : v.chL);
      g.restore();
    });
  }

  pivots(v).forEach((pv, i) => {                             // 3. 針
    const a = angOf(pos[i]) - Math.PI / 2;
    const tx = pv.x + Math.cos(a) * (v.radius - 14);
    const ty = pv.y + Math.sin(a) * (v.radius - 14);
    g.save();
    g.lineCap = "round";
    g.strokeStyle = "rgba(0,0,0,.30)"; g.lineWidth = 5;
    g.beginPath(); g.moveTo(pv.x + 3, pv.y + 3); g.lineTo(tx + 3, ty + 3); g.stroke();
    g.strokeStyle = v.needle; g.lineWidth = 3.2;
    g.beginPath(); g.moveTo(pv.x, pv.y); g.lineTo(tx, ty); g.stroke();
    g.fillStyle = v.needle;
    g.beginPath(); g.arc(pv.x, pv.y, 7, 0, Math.PI * 2); g.fill();
    g.restore();
  });

  if (s.lamp > 0) {                                          // 4. 照明
    // 電球は文字板ごとに、下の枠の裏の中央にある。文字板を裏から透かすのではなく、
    // 下から表面を照らすので、下端の中央がいちばん明るく、上と左右へ弱まる。
    const LAMP_SPREAD = 1.35;                                // 光は縦より横に広がる
    const reach = w.height * 1.05;
    g.save();
    g.globalCompositeOperation = "lighter";
    pivots(v).forEach((pv) => {
      g.save();
      g.translate(pv.x, w.top + w.height + v.radius * 0.06); // 光源は窓の下端より少し下（枠に隠れる）
      g.scale(LAMP_SPREAD, 1);
      g.fillStyle = memoGrad(`${v.id}|lamp|${s.lamp}`, () => {
        const lg = g.createRadialGradient(0, 0, 0, 0, 0, reach);
        lg.addColorStop(0, `rgba(${v.lamp},${0.5 * s.lamp})`);
        lg.addColorStop(0.25, `rgba(${v.lamp},${0.26 * s.lamp})`);
        lg.addColorStop(0.6, `rgba(${v.lamp},${0.08 * s.lamp})`);
        lg.addColorStop(1, `rgba(${v.lamp},0)`);
        return lg;
      });
      g.fillRect(-reach, -reach, reach * 2, reach);
      g.restore();
    });
    g.restore();
  }

  if (s.shadow > 0) drawShadow(g, v, s.shadow);              // 5. 枠の影

  // 汚れと割れは透過で重ねる。暗い成分（油じみ・ひびの影）があるので、足し算では表せない。
  const over = (src: CanvasImageSource, alpha: number) => {
    g.save();
    g.globalAlpha = Math.min(1, alpha);
    g.drawImage(src, w.left, w.top, w.width, w.height);
    g.restore();
  };
  if (s.grime > 0) over(L.grime, s.grime);                   // 6. 汚れ
  if (s.cracks > 0) over(L.cracks, s.cracks);                // 7. 割れ
  if (s.glass > 0) {                                         // 8. ガラス
    g.save();
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = Math.min(1, s.glass);
    g.drawImage(L.glass, w.left, w.top, w.width, w.height);
    g.restore();
  }
  g.restore();

  // 9. 外枠。窓の外側だけにクリップするので、枠画像の黒い窓は描かれない。
  g.save();
  g.beginPath();
  g.rect(0, 0, v.panel[0], v.panel[1]);
  g.rect(w.left, w.top, w.width, w.height);
  g.clip("evenodd");
  g.drawImage(L.bezel, 0, 0, v.panel[0], v.panel[1]);
  g.restore();
}
