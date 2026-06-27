export type ItemKind = "Label" | "SensorText" | "Gauge" | "GraphLine" | "BarH" | "BarV" | "Image";

export interface Rect { x: number; y: number; w: number; h: number; }

export interface Style {
  fontFamily: string;   // 各アイテム独立
  fontSize: number;
  fontWeight: "normal" | "bold";
  color: string;
  align: "left" | "center" | "right";
}

export type GaugeRender =
  | { mode: "VectorArc" }
  | { mode: "NeedleRotate"; dialAsset?: string; needleAsset: string; pivot: [number, number]; angleStart: number; angleEnd: number; }
  | { mode: "SpriteStrip"; spriteAsset: string; frameCount: number; orientation: "horizontal" | "vertical"; };

export interface PanelItem {
  id: string;
  kind: ItemKind;
  rect: Rect;
  z: number;
  rotation: number;   // 度（左上原点まわり）
  opacity: number;
  sensorSrc?: string;
  style: Style;
  range?: [number, number];   // 無ければグラフは自動スケール
  asset?: string;
  gauge?: GaugeRender;
  format?: string;
  unit?: string;              // グラフ等のスケール表示に付ける単位（例 "Mbps"）
  bgColor?: string;           // グラフ背景色
  bgOpacity?: number;         // グラフ背景の不透明度 0..1（0=透過）
}

export interface Panel {
  size: Rect;
  background?: string;
  items: PanelItem[];
}

let __idCounter = 0;
function nextId(): string {
  __idCounter += 1;
  return `item_${__idCounter}_${Math.floor(performance.now() * 1000)}`;
}

function defaultStyle(): Style {
  return { fontFamily: "sans-serif", fontSize: 18, fontWeight: "normal", color: "#00ffcc", align: "left" };
}

export function createItem(kind: ItemKind, pos: { x: number; y: number }): PanelItem {
  const base: PanelItem = {
    id: nextId(),
    kind,
    rect: { x: pos.x, y: pos.y, w: 120, h: 32 },
    z: 0,
    rotation: 0,
    opacity: 1,
    style: defaultStyle(),
  };
  if (kind === "Label") base.format = "Label";
  if (kind === "SensorText") { base.format = "%d"; base.sensorSrc = undefined; }
  if (kind === "Gauge") { base.rect.w = 120; base.rect.h = 120; base.range = [0, 100]; base.gauge = { mode: "VectorArc" }; base.format = "%d"; }
  if (kind === "GraphLine") { base.rect.w = 240; base.rect.h = 80; base.unit = ""; base.bgColor = "#0d0d0d"; base.bgOpacity = 0; } // range無し=自動スケール、背景は透過
  if (kind === "BarH") { base.rect.w = 160; base.rect.h = 24; base.range = [0, 100]; }
  if (kind === "BarV") { base.rect.w = 24; base.rect.h = 120; base.range = [0, 100]; }
  return base;
}

export function createPanel(w: number, h: number): Panel {
  return { size: { x: 0, y: 0, w, h }, items: [] };
}
