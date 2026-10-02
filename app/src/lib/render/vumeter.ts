// アナログVUメーター。枠・紙・ガラスの質感は生成画像、幾何（目盛・針・影・割れ）は線で描く。
// 生成側に厳密な座標を要求するとコード描画に落ちるため、分担をこう切ってある。
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
  /** バックライトの色。 */
  lamp: string;
  /** 文字板の表記。 */
  title: string;
  chL: string;
  chR: string;
  src: { bezel: string; paper: string; glass: string };
}

export const VU_VARIANTS: Record<string, VuVariant> = {
  ussr: {
    id: "ussr",
    label: "ソ連製",
    panel: [2048, 756],
    window: { left: 95, top: 80, width: 1873, height: 597 },
    pivotY: 650,
    radius: 527.4,
    ink: "#241d14",
    red: "#a3231b",
    lamp: "255,206,132",
    title: "УРОВЕНЬ",
    chL: "Л",
    chR: "П",
    src: { bezel: "/vu/ussr/bezel.png", paper: "/vu/ussr/paper.png", glass: "/vu/ussr/glass.png" },
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
  lamp: 0.55, glass: 0.16, grime: 0.45, cracks: 0.7, shadow: 0.45,
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

function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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
  const r = v.radius;
  for (const pv of pivots(v)) {
    const pt = (p: number, rad: number): [number, number] => {
      const a = angOf(p) - Math.PI / 2;
      return [pv.x + Math.cos(a) * rad, pv.y + Math.sin(a) * rad];
    };
    const p0 = posOf(0);
    x.lineCap = "butt";
    x.strokeStyle = v.ink;
    x.lineWidth = r * 0.0095;
    x.beginPath(); x.arc(pv.x, pv.y, r, angOf(0) - Math.PI / 2, angOf(p0) - Math.PI / 2); x.stroke();
    x.strokeStyle = v.red;
    x.lineWidth = r * 0.017;
    x.beginPath(); x.arc(pv.x, pv.y, r, angOf(p0) - Math.PI / 2, angOf(1) - Math.PI / 2); x.stroke();

    // 目盛線は内向き。弧の頂点が窓の上端に近く、外向きだと数字が枠に食われる。
    const TL = r * 0.058;
    for (const db of TICKS) {
      const p = posOf(db);
      const col = db >= 0 ? v.red : v.ink;
      const [ax, ay] = pt(p, r);
      const [bx, by] = pt(p, r - TL);
      x.strokeStyle = col; x.lineWidth = r * 0.0125; x.lineCap = "round";
      x.beginPath(); x.moveTo(ax, ay); x.lineTo(bx, by); x.stroke();
      const lbl = NUMS[String(db)];
      if (lbl) {
        const [cx, cy] = pt(p, r - TL - r * 0.052);
        x.fillStyle = col; x.textAlign = "center"; x.textBaseline = "middle";
        x.font = `700 ${Math.round(r * 0.055)}px "Noto Sans", sans-serif`;
        x.fillText(lbl, cx, cy);
      }
    }

    // 内側のパーセント目盛。0% が弧の左端、100% が 0VU。実機と同じ割り付け。
    const r2 = r * 0.78, TL2 = r * 0.04;
    x.strokeStyle = v.ink; x.lineWidth = r * 0.0065;
    x.beginPath(); x.arc(pv.x, pv.y, r2, angOf(0) - Math.PI / 2, angOf(p0) - Math.PI / 2); x.stroke();
    for (const val of PCT) {
      const p = val / (100 * FULL);
      const [ax, ay] = pt(p, r2);
      const [bx, by] = pt(p, r2 - TL2);
      x.strokeStyle = v.ink; x.lineWidth = r * 0.0085; x.lineCap = "round";
      x.beginPath(); x.moveTo(ax, ay); x.lineTo(bx, by); x.stroke();
      const [cx, cy] = pt(p, r2 - TL2 - r * 0.04);
      x.fillStyle = v.ink; x.textAlign = "center"; x.textBaseline = "middle";
      x.font = `500 ${Math.round(r * 0.04)}px "Noto Sans", sans-serif`;
      x.fillText(String(val), cx, cy);
    }
    x.fillStyle = v.ink;
    x.beginPath(); x.arc(pv.x, pv.y, r * 0.034, 0, Math.PI * 2); x.fill();
  }
  return c;
}

/** ガラスの割れ。生成ラスタは縮小と加算で消えるので線で描く。 */
export function buildCracks(v: VuVariant): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = v.panel[0];
  c.height = v.panel[1];
  const x = c.getContext("2d")!;
  const w = v.window;
  const R = rng(20260401);
  x.save();
  x.beginPath(); x.rect(w.left, w.top, w.width, w.height); x.clip();
  x.globalCompositeOperation = "lighter";
  x.lineCap = "round";
  x.filter = "blur(0.8px)";
  const diag = Math.hypot(w.width, w.height);

  const seg = (x0: number, y0: number, ang: number, len: number, wid: number, al: number): [number, number][] => {
    const n = Math.max(2, Math.round(len / 26));
    let cx = x0, cy = y0, a = ang;
    const pts: [number, number][] = [[cx, cy]];
    for (let i = 0; i < n; i++) {
      a += (R() - 0.5) * 0.18;
      cx += Math.cos(a) * (len / n); cy += Math.sin(a) * (len / n);
      pts.push([cx, cy]);
    }
    const stroke = (style: string, lw: number) => {
      x.strokeStyle = style; x.lineWidth = lw;
      x.beginPath(); x.moveTo(pts[0][0], pts[0][1]);
      for (let k = 1; k < pts.length; k++) x.lineTo(pts[k][0], pts[k][1]);
      x.stroke();
    };
    stroke(`rgba(214,206,186,${al * 0.3})`, wid * 7.5);   // にじみ
    stroke(`rgba(228,221,201,${al * 0.42})`, wid * 0.85); // 芯
    return pts;
  };

  const origins: [number, number, number, number][] = [
    [w.left + w.width * 0.3, w.top + w.height * 0.4, 9, 1.0],
    [w.left + w.width * 0.71, w.top + w.height * 0.63, 7, 0.78],
  ];
  for (const [ox, oy, n, scl] of origins) {
    const rad: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + R() * 0.5;
      const len = diag * (0.22 + R() * 0.7) * scl;
      const pts = seg(ox, oy, a, len, 1.1 + R() * 1.3, 0.34 + R() * 0.3);
      rad.push(a);
      const nb = 1 + Math.floor(R() * 3);
      for (let b = 0; b < nb; b++) {
        const ti = Math.floor(pts.length * (0.32 + R() * 0.45));
        if (ti >= pts.length) continue;
        const [px, py] = pts[ti];
        seg(px, py, a + (R() < 0.5 ? -1 : 1) * (0.28 + R() * 0.46),
            len * (0.16 + R() * 0.34), 0.8 + R() * 0.9, 0.22 + R() * 0.22);
      }
    }
    // 起点近くの破片状。隣の放射線をたわんだ弦でつなぐ。
    for (let ring = 0; ring < 5; ring++) {
      const rr = 14 + ring * ring * 7 + R() * 12;
      for (let j = 0; j < n; j++) {
        const a1 = rad[j];
        let a2 = rad[(j + 1) % n];
        if (a2 < a1) a2 += Math.PI * 2;
        const m = (a1 + a2) / 2, bow = rr * (0.8 + R() * 0.22);
        x.strokeStyle = `rgba(222,215,196,${0.07 + R() * 0.08})`;
        x.lineWidth = 0.8 + R() * 0.7;
        x.beginPath();
        x.moveTo(ox + Math.cos(a1) * rr, oy + Math.sin(a1) * rr);
        x.quadraticCurveTo(ox + Math.cos(m) * bow, oy + Math.sin(m) * bow,
                           ox + Math.cos(a2) * rr, oy + Math.sin(a2) * rr);
        x.stroke();
      }
    }
  }
  x.restore();
  return c;
}

/** ガラスを強くぼかした汚れの層。生成画像そのものは加工しない。 */
export function buildGrime(v: VuVariant, glass: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = v.panel[0];
  c.height = v.panel[1];
  const x = c.getContext("2d")!;
  const w = v.window;
  x.save();
  x.beginPath(); x.rect(w.left, w.top, w.width, w.height); x.clip();
  x.filter = "blur(11px)";
  x.drawImage(glass, w.left, w.top, w.width, w.height);
  x.restore();
  return c;
}

// グラデーションを使い回す。毎フレーム作ると Blink 側に溜まり、ページのメモリが増え続けた
// （visualizers.ts の memoGrad と同じ理由）。座標は素材の座標系の定数なので、
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
  cracks: HTMLCanvasElement;
  grime: HTMLCanvasElement;
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
      g.fillStyle = v.ink; g.globalAlpha = 0.88;
      g.textAlign = "center"; g.textBaseline = "middle";
      g.font = `700 ${Math.round(r * 0.075)}px "Noto Sans", sans-serif`;
      g.fillText(v.title, pv.x, pv.y - r * 0.53);
      g.font = `500 ${Math.round(r * 0.062)}px "Noto Sans", sans-serif`;
      g.fillText(i ? v.chR : v.chL, pv.x - r * 0.615, pv.y - r * 0.4);
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
    g.strokeStyle = "#15110c"; g.lineWidth = 3.2;
    g.beginPath(); g.moveTo(pv.x, pv.y); g.lineTo(tx, ty); g.stroke();
    g.fillStyle = "#15110c";
    g.beginPath(); g.arc(pv.x, pv.y, 7, 0, Math.PI * 2); g.fill();
    g.restore();
  });

  if (s.lamp > 0) {                                          // 4. バックライト
    g.save();
    g.globalCompositeOperation = "lighter";
    pivots(v).forEach((pv, i) => {
      const cy = pv.y - v.radius * 0.45;
      g.fillStyle = memoGrad(`${v.id}|lamp|${i}|${s.lamp}`, () => {
        const lg = g.createRadialGradient(pv.x, cy, 4, pv.x, cy, v.radius * 0.95);
        lg.addColorStop(0, `rgba(${v.lamp},${0.3 * s.lamp})`);
        lg.addColorStop(1, `rgba(${v.lamp},0)`);
        return lg;
      });
      g.fillRect(w.left, w.top, w.width, w.height);
    });
    g.restore();
  }

  if (s.shadow > 0) drawShadow(g, v, s.shadow);              // 5. 枠の影

  const add = (src: CanvasImageSource, alpha: number) => {
    g.save();
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = Math.min(1, alpha);
    g.drawImage(src, 0, 0);
    g.restore();
  };
  if (s.grime > 0) add(L.grime, s.grime);                    // 6. 汚れ
  if (s.cracks > 0) add(L.cracks, s.cracks);                 // 7. 割れ
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
