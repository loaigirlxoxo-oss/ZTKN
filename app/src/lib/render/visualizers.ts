// 音声ビジュアライザ10種。カタログで選ばれた意匠をそのまま移植してある。
//
// Konva のレイヤーは毎フレーム消えるので、残像・履歴を持つ意匠のために
// 部品ごとにオフスクリーンのキャンバスを持ち、そこへ描いてから貼る。

export type Scheme = "cyber" | "synth" | "matrix" | "ice" | "amber" | "toxic" | "plasma" | "blood" | "mono";
export type WaveDesign =
  | "bars-solid" | "bars-seg" | "terrain" | "vector" | "ring-bars"
  | "polar" | "blob" | "orbit" | "particles" | "led" | "vu";

type RGB = [number, number, number];
interface SchemeDef { a: RGB; b: RGB; c: RGB; bg: RGB; cap: string }

export const SCHEMES: Record<Scheme, SchemeDef> = {
  cyber:  { a: [0, 150, 200],  b: [0, 229, 255],   c: [253, 224, 71],  bg: [4, 8, 13],  cap: "#eafcff" },
  synth:  { a: [34, 211, 238], b: [168, 85, 247],  c: [255, 46, 136],  bg: [6, 4, 14],  cap: "#ffd9ec" },
  matrix: { a: [0, 90, 48],    b: [0, 220, 110],   c: [190, 255, 140], bg: [2, 8, 4],   cap: "#e7ffe9" },
  ice:    { a: [40, 92, 150],  b: [125, 211, 252], c: [240, 252, 255], bg: [4, 9, 16],  cap: "#ffffff" },
  amber:  { a: [104, 44, 8],   b: [255, 150, 30],  c: [255, 238, 190], bg: [10, 6, 2],  cap: "#fff4d6" },
  toxic:  { a: [10, 110, 110], b: [74, 222, 128],  c: [220, 255, 60],  bg: [3, 10, 8],  cap: "#f2ffd0" },
  plasma: { a: [62, 44, 180],  b: [236, 72, 200],  c: [255, 150, 40],  bg: [7, 4, 16],  cap: "#ffe2c0" },
  blood:  { a: [96, 10, 18],   b: [239, 48, 54],   c: [255, 208, 80],  bg: [10, 3, 4],  cap: "#ffe9c2" },
  mono:   { a: [70, 80, 92],   b: [160, 175, 190], c: [255, 255, 255], bg: [6, 7, 9],   cap: "#ffffff" },
};

export const SCHEME_LABELS: Record<Scheme, string> = {
  cyber: "サイバー（シアン→黄）", synth: "シンセウェイブ（シアン→紫→桃）",
  matrix: "マトリックス（緑燐光）", ice: "アイス（鋼青→白）",
  amber: "アンバー（琥珀）", toxic: "トキシック（青緑→黄緑）",
  plasma: "プラズマ（藍→桃→橙）", blood: "ブラッド（暗赤→赤→黄）", mono: "モノクロ（灰→白）",
};

export const DESIGN_LABELS: Record<WaveDesign, string> = {
  vu: "VUメーター（アナログ針）",
  "bars-solid": "ソリッド（棒）",
  "bars-seg": "セグメント（棒）",
  terrain: "地形（履歴）",
  vector: "ベクタースコープ（位相）",
  "ring-bars": "リングバー（円形）",
  polar: "ポーラー波形（円形）",
  blob: "ブロブ（円形）",
  orbit: "オービット（円形）",
  particles: "パーティクル（空間）",
  led: "LEDマトリクス（計器）",
};

export interface WaveSettings {
  design: WaveDesign;
  scheme: Scheme;
  smooth: number;   // 落ちの粘り 0..1
  glow: number;     // グロー 0..34
  trail: number;    // 残像 0..1
  bands: number;    // 帯数 8..64
  gain: number;     // 感度
  gap: number;      // バー間隔 px
  peak: boolean;    // ピーク保持線
  bg: boolean;      // 背景を塗るか（falseなら透過してパネルの背景が出る）
}

export const WAVE_DEFAULTS: WaveSettings = {
  design: "bars-solid", scheme: "cyber", smooth: 0.7, glow: 12,
  trail: 0.55, bands: 40, gain: 1, gap: 2, peak: true, bg: false,
};

const mix = (x: RGB, y: RGB, t: number): RGB =>
  [Math.round(x[0] + (y[0] - x[0]) * t), Math.round(x[1] + (y[1] - x[1]) * t), Math.round(x[2] + (y[2] - x[2]) * t)];
const rgb = (c: RGB, a = 1): string => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/** Rust から来た生データ。bands は 0..255、波形は -127..127。 */
export interface RawAudio { bands: number[]; wl: number[]; wr: number[] }

const BAND_SRC = 64;
const WAVE_N = 128;

/** 部品ごとの状態。残像・履歴・粒子はここに持つ。 */
export class WaveState {
  cur = new Float32Array(64);
  pk = new Float32Array(64);
  wl = new Float32Array(WAVE_N);
  wr = new Float32Array(WAVE_N);
  bass = 0;
  private bassAvg = 0;
  kick = false;
  private lastKick = 0;
  /** 意匠ごとの作業領域（地形の履歴、粒子の配列など）。 */
  st: Record<string, unknown> = {};
  canvas: HTMLCanvasElement | null = null;
  private design: WaveDesign | null = null;

  /** 意匠を変えたら作業領域と画面を捨てる。前の意匠の残像が残らないように。 */
  private resetIfDesignChanged(d: WaveDesign): void {
    if (this.design === d) return;
    this.design = d;
    this.st = {};
    if (this.canvas) {
      const g = this.canvas.getContext("2d");
      if (g) g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  private lastTick = -1;

  /**
   * 生データを取り込み、感度・粘り・ピーク保持を当てる。
   * sceneFunc は1フレームに複数回呼ばれうるので、同じ時刻では一度しか進めない
   * （二重に進むと平滑化が倍速になり、粒子も倍の速さで飛ぶ）。
   */
  update(raw: RawAudio, s: WaveSettings, now: number): void {
    if (now === this.lastTick) return;
    this.lastTick = now;
    this.resetIfDesignChanged(s.design);
    const n = Math.max(8, Math.min(64, s.bands));
    const fall = Math.pow(1 - s.smooth, 2) * 0.9 + 0.004;
    const src = raw.bands;
    for (let i = 0; i < n; i++) {
      // 帯数を減らすときは元の64帯をまとめる（間引くと谷が消える）。
      const lo = Math.floor((i * BAND_SRC) / n);
      const hi = Math.max(lo + 1, Math.floor(((i + 1) * BAND_SRC) / n));
      let m = 0;
      for (let k = lo; k < hi && k < src.length; k++) m = Math.max(m, src[k]);
      let v = (m / 255) * s.gain;
      if (v > 1) v = 1;
      this.cur[i] = v > this.cur[i] ? v : this.cur[i] + (v - this.cur[i]) * fall;
      this.pk[i] = v > this.pk[i] ? v : Math.max(0, this.pk[i] - 0.005);
    }
    for (let i = 0; i < WAVE_N; i++) {
      this.wl[i] = (raw.wl[i] ?? 0) / 127;
      this.wr[i] = (raw.wr[i] ?? 0) / 127;
    }
    // 低域のエネルギー。拍頭は移動平均からの立ち上がりで見る。
    let low = 0;
    const lowN = Math.max(1, Math.round(n * 0.18));
    for (let i = 0; i < lowN; i++) low += this.cur[i];
    low /= lowN;
    this.bass = this.bass * 0.82 + low * 0.18;
    this.bassAvg = this.bassAvg * 0.95 + low * 0.05;
    this.kick = false;
    if (low > this.bassAvg * 1.5 && low > 0.12 && now - this.lastKick > 120) {
      this.kick = true;
      this.lastKick = now;
    }
  }
}

interface DrawCtx {
  g: CanvasRenderingContext2D;
  w: number;
  h: number;
  s: WaveSettings;
  d: WaveState;
  sc: SchemeDef;
  tone: (v: number) => RGB;
  n: number;
}

function fade(c: DrawCtx): void {
  const { g, s, sc } = c;
  if (!s.bg) {
    // 背景を塗らない設定では、残像のぶんだけ消して透過を保つ。
    g.save();
    g.globalCompositeOperation = "destination-out";
    const k = 1 - s.trail;
    g.fillStyle = `rgba(0,0,0,${s.trail <= 0 ? 1 : k * k * 0.9 + 0.03})`;
    g.fillRect(0, 0, c.w, c.h);
    g.restore();
    return;
  }
  const k = 1 - s.trail;
  g.fillStyle = rgb(sc.bg, s.trail <= 0 ? 1 : k * k * 0.9 + 0.03);
  g.fillRect(0, 0, c.w, c.h);
}
const lit = (c: DrawCtx, col: RGB): void => {
  c.g.globalCompositeOperation = "lighter";
  c.g.shadowBlur = c.s.glow;
  c.g.shadowColor = rgb(col, 1);
};
const plain = (c: DrawCtx): void => {
  c.g.globalCompositeOperation = "source-over";
  c.g.shadowBlur = 0;
};

// ---- 棒 ----------------------------------------------------------------
function barsSolid(c: DrawCtx): void {
  fade(c);
  const { g, w, h, s, d, n } = c;
  const base = h - 3, span = h - 9, slot = w / n, bw = Math.max(1, slot - s.gap);
  for (let i = 0; i < n; i++) {
    const v = d.cur[i], col = c.tone(v);
    const x = i * slot + (slot - bw) / 2, bh = Math.max(1, v * span);
    lit(c, col);
    const gr = g.createLinearGradient(0, base, 0, base - bh);
    gr.addColorStop(0, rgb(c.tone(Math.max(0, v - 0.45)), 0.95));
    gr.addColorStop(1, rgb(col, 1));
    g.fillStyle = gr;
    g.fillRect(x, base - bh, bw, bh);
    if (s.peak && d.pk[i] > 0.02) {
      g.fillStyle = c.sc.cap; g.shadowColor = c.sc.cap;
      g.fillRect(x, base - Math.max(1, d.pk[i] * span) - 2, bw, 2);
    }
  }
  plain(c);
}

function barsSeg(c: DrawCtx): void {
  fade(c);
  const { g, w, h, s, d, n } = c;
  const base = h - 3, span = h - 9, slot = w / n, bw = Math.max(1, slot - s.gap);
  const segs = Math.max(5, Math.round(span / 7)), sh = span / segs;
  for (let i = 0; i < n; i++) {
    const v = d.cur[i], x = i * slot + (slot - bw) / 2, on = Math.round(v * segs);
    for (let seg = 0; seg < segs; seg++) {
      const col = c.tone((seg + 1) / segs);
      if (seg < on) { lit(c, col); g.fillStyle = rgb(col, 1); }
      else { plain(c); g.fillStyle = rgb(col, 0.07); }
      g.fillRect(x, base - (seg + 1) * sh + 1, bw, sh - 2);
    }
  }
  plain(c);
}

// ---- 時間を残す --------------------------------------------------------
function terrain(c: DrawCtx): void {
  const { g, w, h, d, n } = c;
  const st = (d.st.rows ??= []) as Float32Array[];
  d.st.tick = ((d.st.tick as number) ?? 0) + 1;
  if ((d.st.tick as number) % 2 === 0) {
    st.unshift(Float32Array.from(d.cur.subarray(0, n)));
    if (st.length > 16) st.pop();
  }
  fade(c);
  for (let r = st.length - 1; r >= 0; r--) {
    const row = st[r], dep = r / 16; // 0=手前
    const y0 = h * 0.3 + h * 0.66 * (1 - dep), sc = 0.3 + 0.7 * (1 - dep), inset = w * 0.14 * dep;
    const col = c.tone(0.25 + (1 - dep) * 0.55);
    lit(c, col);
    g.strokeStyle = rgb(col, 0.28 + (1 - dep) * 0.72);
    g.lineWidth = 1 + (1 - dep) * 1.2;
    g.lineJoin = "round";
    g.beginPath();
    for (let i = 0; i < row.length; i++) {
      const x = inset + (w - inset * 2) * (i / Math.max(1, row.length - 1));
      const y = y0 - row[i] * (h * 0.34) * sc;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  }
  plain(c);
}

// ---- 位相 --------------------------------------------------------------
function vector(c: DrawCtx): void {
  fade(c);
  const { g, w, h, d } = c;
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.42;
  plain(c);
  g.strokeStyle = rgb(c.tone(0.2), 0.22);
  g.lineWidth = 1;
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
  g.beginPath();
  g.moveTo(cx - R, cy + R); g.lineTo(cx + R, cy - R);
  g.moveTo(cx - R, cy - R); g.lineTo(cx + R, cy + R);
  g.globalAlpha = 0.4; g.stroke(); g.globalAlpha = 1;
  const col = c.tone(Math.min(1, d.bass * 1.2 + 0.3));
  lit(c, col);
  g.strokeStyle = rgb(col, 0.95); g.lineWidth = 1.6; g.lineJoin = "round";
  g.beginPath();
  for (let i = 0; i < d.wl.length; i++) {
    const x = cx + d.wl[i] * R, y = cy - d.wr[i] * R;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.stroke();
  plain(c);
}

// ---- 円形 --------------------------------------------------------------
function ringBars(c: DrawCtx): void {
  fade(c);
  const { g, w, h, s, d, n } = c;
  const cx = w / 2, cy = h / 2;
  const rIn = Math.min(w, h) * 0.2, rMax = Math.min(w, h) * 0.46 - rIn;
  const coreR = rIn * (0.52 + d.bass * 0.42);
  lit(c, c.tone(Math.min(1, d.bass * 1.6)));
  const rg = g.createRadialGradient(cx, cy, 0, cx, cy, coreR);
  rg.addColorStop(0, rgb(c.tone(Math.min(1, 0.3 + d.bass)), 0.85));
  rg.addColorStop(1, rgb(c.tone(0.1), 0));
  g.fillStyle = rg;
  g.beginPath(); g.arc(cx, cy, coreR, 0, Math.PI * 2); g.fill();
  plain(c);
  const step = (Math.PI * 2) / n, bw = Math.max(1.5, rIn * step - s.gap * 0.5);
  for (let i = 0; i < n; i++) {
    const v = d.cur[i], col = c.tone(v), ang = -Math.PI / 2 + i * step, len = Math.max(1.5, v * rMax);
    g.save();
    g.translate(cx + Math.cos(ang) * rIn, cy + Math.sin(ang) * rIn);
    g.rotate(ang);
    lit(c, col);
    g.fillStyle = rgb(col, 1);
    g.fillRect(0, -bw / 2, len, bw);
    if (s.peak && d.pk[i] > 0.02) {
      g.fillStyle = c.sc.cap; g.shadowColor = c.sc.cap;
      g.fillRect(Math.max(1.5, d.pk[i] * rMax), -bw / 2, 2, bw);
    }
    g.restore();
  }
  plain(c);
}

function polar(c: DrawCtx): void {
  fade(c);
  const { g, w, h, d } = c;
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.3;
  const col = c.tone(Math.min(1, d.bass * 1.2 + 0.3));
  lit(c, col);
  for (let pass = 0; pass < 2; pass++) {
    const src = pass ? d.wr : d.wl;
    g.beginPath();
    for (let i = 0; i <= src.length; i++) {
      const idx = i % src.length, ang = (idx / src.length) * Math.PI * 2 - Math.PI / 2;
      const r = R + src[idx] * R * 0.85;
      const x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.closePath();
    g.strokeStyle = rgb(pass ? c.tone(0.35) : col, pass ? 0.5 : 1);
    g.lineWidth = pass ? 1 : 1.8;
    g.lineJoin = "round";
    g.stroke();
  }
  plain(c);
}

function blob(c: DrawCtx): void {
  fade(c);
  const { g, w, h, d, n } = c;
  const cx = w / 2, cy = h / 2;
  const rIn = Math.min(w, h) * 0.17, rMax = Math.min(w, h) * 0.45 - rIn;
  const col = c.tone(Math.min(1, d.bass * 1.3 + 0.25));
  lit(c, col);
  g.beginPath();
  for (let i = 0; i <= n; i++) {
    const idx = i % n, ang = -Math.PI / 2 + idx * ((Math.PI * 2) / n), r = rIn + d.cur[idx] * rMax;
    const x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.closePath();
  const rg = g.createRadialGradient(cx, cy, rIn * 0.3, cx, cy, rIn + rMax);
  rg.addColorStop(0, rgb(c.tone(0.85), 0.5));
  rg.addColorStop(1, rgb(col, 0.1));
  g.fillStyle = rg; g.fill();
  g.strokeStyle = rgb(col, 1); g.lineWidth = 1.8; g.lineJoin = "round"; g.stroke();
  plain(c);
}

function orbit(c: DrawCtx): void {
  fade(c);
  const { g, w, h, d, n } = c;
  const cx = w / 2, cy = h / 2;
  d.st.ph = ((d.st.ph as number) ?? 0) + 0.012;
  const ph = d.st.ph as number;
  const rIn = Math.min(w, h) * 0.1, rMax = Math.min(w, h) * 0.44 - rIn;
  for (let i = 0; i < n; i++) {
    const v = d.cur[i], col = c.tone(v);
    const ang = ph * (1 + i * 0.035) + i * ((Math.PI * 2) / n);
    const r = rIn + (0.18 + v * 0.82) * rMax;
    lit(c, col);
    g.fillStyle = rgb(col, 1);
    g.beginPath();
    g.arc(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r, 1.2 + v * 2.6, 0, Math.PI * 2);
    g.fill();
  }
  plain(c);
}

// ---- 空間 --------------------------------------------------------------
interface Particle { x: number; y: number; vx: number; vy: number; l: number }

function particles(c: DrawCtx): void {
  fade(c);
  const { g, w, h, d } = c;
  const cx = w / 2, cy = h / 2;
  const p = (d.st.p ??= []) as Particle[];
  if (d.kick) {
    const burst = 10 + Math.round(d.bass * 22);
    for (let k = 0; k < burst; k++) {
      const a = Math.random() * Math.PI * 2, sp = 0.6 + Math.random() * 2.3 * (1 + d.bass);
      p.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, l: 1 });
    }
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    q.x += q.vx; q.y += q.vy; q.vx *= 0.985; q.vy *= 0.985; q.l -= 0.016;
    if (q.l <= 0 || q.x < -8 || q.x > w + 8 || q.y < -8 || q.y > h + 8) { p.splice(i, 1); continue; }
    const col = c.tone(q.l);
    lit(c, col);
    g.fillStyle = rgb(col, q.l);
    g.beginPath(); g.arc(q.x, q.y, 1 + q.l * 2.2, 0, Math.PI * 2); g.fill();
  }
  if (p.length > 420) p.splice(0, p.length - 420);
  plain(c);
}

// ---- 計器 --------------------------------------------------------------
function ledMatrix(c: DrawCtx): void {
  fade(c);
  const { g, w, h, d, n } = c;
  const cols = Math.min(n, 32);
  const rows = Math.max(5, Math.floor(h / 9)), cw = w / cols, ch = h / rows;
  const r = Math.max(1, Math.min(cw, ch) * 0.34);
  for (let i = 0; i < cols; i++) {
    const idx = Math.floor((i * n) / cols), v = d.cur[idx], on = Math.round(v * rows);
    for (let seg = 0; seg < rows; seg++) {
      const col = c.tone((seg + 1) / rows);
      const x = i * cw + cw / 2, y = h - (seg + 0.5) * ch;
      if (seg < on) { lit(c, col); g.fillStyle = rgb(col, 1); }
      else { plain(c); g.fillStyle = rgb(col, 0.08); }
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
  }
  plain(c);
}

const DESIGNS: Partial<Record<WaveDesign, (c: DrawCtx) => void>> = {
  "bars-solid": barsSolid,
  "bars-seg": barsSeg,
  terrain,
  vector,
  "ring-bars": ringBars,
  polar,
  blob,
  orbit,
  particles,
  led: ledMatrix,
};

/**
 * 部品のオフスクリーンへ1フレーム描き、そのキャンバスを返す。
 * VUメーターはここでは扱わない（専用モジュール）。
 */
export function drawWave(d: WaveState, s: WaveSettings, w: number, h: number): HTMLCanvasElement | null {
  const fn = DESIGNS[s.design];
  if (!fn) return null;
  const cw = Math.max(1, Math.round(w)), chh = Math.max(1, Math.round(h));
  if (!d.canvas) d.canvas = document.createElement("canvas");
  const cv = d.canvas;
  if (cv.width !== cw || cv.height !== chh) {
    cv.width = cw; cv.height = chh;
    const g0 = cv.getContext("2d");
    // 大きさが変わると中身は捨てられる。履歴も合わせて捨てる。
    if (g0 && s.bg) { g0.fillStyle = rgb(SCHEMES[s.scheme].bg, 1); g0.fillRect(0, 0, cw, chh); }
    d.st = {};
  }
  const g = cv.getContext("2d");
  if (!g) return null;
  const sc = SCHEMES[s.scheme] ?? SCHEMES.cyber;
  const tone = (v: number): RGB => {
    const x = v < 0 ? 0 : v > 1 ? 1 : v;
    return x < 0.5 ? mix(sc.a, sc.b, x / 0.5) : mix(sc.b, sc.c, (x - 0.5) / 0.5);
  };
  g.globalAlpha = 1;
  fn({ g, w: cw, h: chh, s, d, sc, tone, n: Math.max(8, Math.min(64, s.bands)) });
  g.globalCompositeOperation = "source-over";
  g.shadowBlur = 0;
  g.globalAlpha = 1;
  return cv;
}
