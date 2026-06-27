# Implementation Plan: PC Status Panel — Phase 1（エディター骨格 + ダミー値）

**Goal:** Konvaキャンバス上にアイテムを追加・選択・移動・リサイズ・プロパティ編集でき、ダミーのセンサー値でゲージ/バー/テキストが動き、Panel JSONを保存/読込できるエディターの骨格を作る。
**Architecture:** Tauri(Rust)バックエンドは Phase1 では「Panel JSONのファイル保存/読込コマンド」のみ担当。描画・編集ロジックは Svelte + TypeScript + Konva.js のフロントに集約。テスト可能な純粋ロジック（モデル生成・値フォーマット・グリッドスナップ・ゲージ角度変換・ダミー値生成・JSON直列化）は vitest で TDD、Konvaの視覚操作は抽出ロジックのユニットテスト＋手動検証で担保。
**Tech Stack:** Tauri 2, Rust, Svelte 5 + TypeScript, Vite, Konva.js, Vitest

参照設計: `docs/plans/2026-06-27-pc-status-panel-design.md`

---

## 前提・規約

- 作業ディレクトリ: `d:/VSCode/PC Status`
- アプリ本体は `app/` 配下に作る（Tauri標準構成: `app/src`=フロント, `app/src-tauri`=Rust）
- パッケージマネージャは pnpm（npm でも可。コマンドは pnpm 表記）
- Phase1 のゲージは画像未使用の `VectorArc` のみ（画像ゲージは Phase1.5）
- Phase1 のアイテム種別は `Label / SensorText / Gauge / BarH / BarV` を対象。`GraphLine / Image` は Phase1.5 以降
- Rust struct は Phase1 ではフロントの型定義が主。Rust は JSON を透過保存するため `serde_json::Value` で受ける（型の二重管理を避ける）

---

## Task 0: 前提ツール確認

**Step 1: バージョン確認**
Run:
```bash
node -v && pnpm -v && rustc --version && cargo --version
```
Expected: いずれも version 文字列が出る（pnpm 未導入なら `npm i -g pnpm`、Rust 未導入なら https://rustup.rs）

期待が満たせない場合はここで停止し、ツールを導入してから次へ。

---

## Task 1: Tauri + Svelte-TS プロジェクト雛形

**Files:**
- Create: `app/` 一式（generator が生成）

**Step 1: 雛形生成**
Run:
```bash
cd "d:/VSCode/PC Status"
pnpm create tauri-app@latest app --template svelte-ts --manager pnpm -y
```
Expected: `app/` に `src/`, `src-tauri/`, `package.json` が生成される

**Step 2: 依存インストール**
Run:
```bash
cd "d:/VSCode/PC Status/app" && pnpm install
```
Expected: `node_modules` 生成、エラーなし

**Step 3: 起動確認（手動）**
Run:
```bash
cd "d:/VSCode/PC Status/app" && pnpm tauri dev
```
Expected: デスクトップウィンドウが開き Svelte の初期画面が表示される。確認したら Ctrl+C で停止。

**Step 4: コミット**
```bash
cd "d:/VSCode/PC Status"
git init
git add -A
git commit -m "chore: scaffold tauri + svelte-ts app"
```

---

## Task 2: Konva と Vitest を追加・設定

**Files:**
- Modify: `app/package.json`
- Create: `app/vitest.config.ts`
- Create: `app/src/lib/__tests__/smoke.test.ts`

**Step 1: 依存追加**
Run:
```bash
cd "d:/VSCode/PC Status/app"
pnpm add konva
pnpm add -D vitest jsdom
```
Expected: `konva`, `vitest`, `jsdom` が devDeps/deps に入る

**Step 2: vitest 設定を作成**
Create `app/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
});
```

**Step 3: package.json に test スクリプト追加**
Modify `app/package.json` の `"scripts"` に:
```json
"test": "vitest run",
"test:watch": "vitest"
```

**Step 4: スモークテスト作成**
Create `app/src/lib/__tests__/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

**Step 5: テスト実行**
Run:
```bash
cd "d:/VSCode/PC Status/app" && pnpm test
```
Expected: PASS（1 passed）

**Step 6: コミット**
```bash
git add -A && git commit -m "chore: add konva and vitest"
```

---

## Task 3: データモデル型と createItem ファクトリ

**Files:**
- Create: `app/src/lib/model/panel.ts`
- Create: `app/src/lib/model/panel.test.ts`

**Step 1: 失敗するテストを書く**
Create `app/src/lib/model/panel.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createItem, createPanel, type ItemKind } from "./panel";

describe("createItem", () => {
  it("creates a Label with sane defaults and unique id", () => {
    const a = createItem("Label", { x: 10, y: 20 });
    const b = createItem("Label", { x: 0, y: 0 });
    expect(a.kind).toBe("Label");
    expect(a.rect).toEqual({ x: 10, y: 20, w: 120, h: 32 });
    expect(a.opacity).toBe(1);
    expect(a.style.fontFamily).toBe("sans-serif");
    expect(a.id).not.toBe(b.id);
  });

  it("gives Gauge a default VectorArc render and range", () => {
    const g = createItem("Gauge", { x: 0, y: 0 });
    expect(g.range).toEqual([0, 100]);
    expect(g.gauge).toEqual({ mode: "VectorArc" });
  });
});

describe("createPanel", () => {
  it("creates an empty panel with given size", () => {
    const p = createPanel(1920, 480);
    expect(p.size).toEqual({ x: 0, y: 0, w: 1920, h: 480 });
    expect(p.items).toEqual([]);
  });
});
```

**Step 2: 失敗を確認**
Run: `pnpm test src/lib/model/panel.test.ts`
Expected: FAIL（`./panel` が無い）

**Step 3: 実装**
Create `app/src/lib/model/panel.ts`:
```ts
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
  opacity: number;
  sensorSrc?: string;
  style: Style;
  range?: [number, number];
  asset?: string;
  gauge?: GaugeRender;
  format?: string;
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
    opacity: 1,
    style: defaultStyle(),
  };
  if (kind === "Label") base.format = "Label";
  if (kind === "SensorText") { base.format = "%d"; base.sensorSrc = undefined; }
  if (kind === "Gauge") { base.rect.w = 120; base.rect.h = 120; base.range = [0, 100]; base.gauge = { mode: "VectorArc" }; base.format = "%d"; }
  if (kind === "BarH") { base.rect.w = 160; base.rect.h = 24; base.range = [0, 100]; }
  if (kind === "BarV") { base.rect.w = 24; base.rect.h = 120; base.range = [0, 100]; }
  return base;
}

export function createPanel(w: number, h: number): Panel {
  return { size: { x: 0, y: 0, w, h }, items: [] };
}
```

**Step 4: テスト通過確認**
Run: `pnpm test src/lib/model/panel.test.ts`
Expected: PASS

**Step 5: コミット**
```bash
git add -A && git commit -m "feat: panel data model and item factory"
```

---

## Task 4: 値フォーマット util

**Files:**
- Create: `app/src/lib/render/format.ts`
- Create: `app/src/lib/render/format.test.ts`

**Step 1: 失敗するテスト**
Create `app/src/lib/render/format.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { formatValue } from "./format";

describe("formatValue", () => {
  it("%d rounds to integer", () => {
    expect(formatValue("%d", 74.6)).toBe("75");
  });
  it("%.1f keeps one decimal", () => {
    expect(formatValue("%.1f", 3.14159)).toBe("3.1");
  });
  it("embeds value within surrounding text", () => {
    expect(formatValue("%d °C", 75.2)).toBe("75 °C");
  });
  it("returns the literal text when no token", () => {
    expect(formatValue("CPU", 99)).toBe("CPU");
  });
  it("shows -- for non-finite value", () => {
    expect(formatValue("%d °C", NaN)).toBe("-- °C");
  });
});
```

**Step 2: 失敗確認**
Run: `pnpm test src/lib/render/format.test.ts`
Expected: FAIL

**Step 3: 実装**
Create `app/src/lib/render/format.ts`:
```ts
// 対応トークン: %d, %.<n>f, %f。1トークンのみ置換する素朴実装。
const TOKEN = /%(?:\.(\d+))?([df])/;

export function formatValue(format: string, value: number): string {
  const m = format.match(TOKEN);
  if (!m) return format; // トークンなし=リテラル（Labelなど）
  const finite = Number.isFinite(value);
  let text: string;
  if (!finite) {
    text = "--";
  } else if (m[2] === "d") {
    text = String(Math.round(value));
  } else {
    const digits = m[1] !== undefined ? Number(m[1]) : 6;
    text = value.toFixed(digits);
  }
  return format.replace(TOKEN, text);
}
```

**Step 4: 通過確認**
Run: `pnpm test src/lib/render/format.test.ts`
Expected: PASS

**Step 5: コミット**
```bash
git add -A && git commit -m "feat: value format util"
```

---

## Task 5: グリッドスナップ util

**Files:**
- Create: `app/src/lib/editor/snap.ts`
- Create: `app/src/lib/editor/snap.test.ts`

**Step 1: 失敗するテスト**
Create `app/src/lib/editor/snap.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { snap } from "./snap";

describe("snap", () => {
  it("snaps to nearest grid step", () => {
    expect(snap(23, 10)).toBe(20);
    expect(snap(26, 10)).toBe(30);
  });
  it("returns value unchanged when grid<=1", () => {
    expect(snap(23, 1)).toBe(23);
    expect(snap(23, 0)).toBe(23);
  });
});
```

**Step 2: 失敗確認**
Run: `pnpm test src/lib/editor/snap.test.ts`
Expected: FAIL

**Step 3: 実装**
Create `app/src/lib/editor/snap.ts`:
```ts
export function snap(value: number, grid: number): number {
  if (grid <= 1) return value;
  return Math.round(value / grid) * grid;
}
```

**Step 4: 通過確認**
Run: `pnpm test src/lib/editor/snap.test.ts`
Expected: PASS

**Step 5: コミット**
```bash
git add -A && git commit -m "feat: grid snap util"
```

---

## Task 6: ゲージ値→角度変換 util

**Files:**
- Create: `app/src/lib/render/gauge.ts`
- Create: `app/src/lib/render/gauge.test.ts`

**Step 1: 失敗するテスト**
Create `app/src/lib/render/gauge.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { valueToFraction, valueToAngle } from "./gauge";

describe("valueToFraction", () => {
  it("maps value within range to 0..1 and clamps", () => {
    expect(valueToFraction(50, 0, 100)).toBe(0.5);
    expect(valueToFraction(-10, 0, 100)).toBe(0);
    expect(valueToFraction(150, 0, 100)).toBe(1);
  });
  it("handles zero-width range without NaN", () => {
    expect(valueToFraction(5, 10, 10)).toBe(0);
  });
});

describe("valueToAngle", () => {
  it("interpolates between start and end angle", () => {
    expect(valueToAngle(0, 0, 100, -120, 120)).toBe(-120);
    expect(valueToAngle(100, 0, 100, -120, 120)).toBe(120);
    expect(valueToAngle(50, 0, 100, -120, 120)).toBe(0);
  });
});
```

**Step 2: 失敗確認**
Run: `pnpm test src/lib/render/gauge.test.ts`
Expected: FAIL

**Step 3: 実装**
Create `app/src/lib/render/gauge.ts`:
```ts
export function valueToFraction(value: number, min: number, max: number): number {
  const span = max - min;
  if (span === 0 || !Number.isFinite(value)) return 0;
  const f = (value - min) / span;
  return Math.max(0, Math.min(1, f));
}

export function valueToAngle(value: number, min: number, max: number, angleStart: number, angleEnd: number): number {
  const f = valueToFraction(value, min, max);
  return angleStart + (angleEnd - angleStart) * f;
}
```

**Step 4: 通過確認**
Run: `pnpm test src/lib/render/gauge.test.ts`
Expected: PASS

**Step 5: コミット**
```bash
git add -A && git commit -m "feat: gauge value-to-angle util"
```

---

## Task 7: ダミーセンサー値生成

**Files:**
- Create: `app/src/lib/sensors/dummy.ts`
- Create: `app/src/lib/sensors/dummy.test.ts`

**Step 1: 失敗するテスト**
Create `app/src/lib/sensors/dummy.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { dummyValue, DUMMY_SENSORS } from "./dummy";

describe("dummyValue", () => {
  it("returns a value within the sensor's declared range", () => {
    for (const s of DUMMY_SENSORS) {
      const v = dummyValue(s.id, 1000);
      expect(v).toBeGreaterThanOrEqual(s.min);
      expect(v).toBeLessThanOrEqual(s.max);
    }
  });
  it("is deterministic for the same id and time", () => {
    expect(dummyValue("TCPU", 1234)).toBe(dummyValue("TCPU", 1234));
  });
  it("returns NaN for unknown sensor id", () => {
    expect(Number.isNaN(dummyValue("NOPE", 0))).toBe(true);
  });
});
```

**Step 2: 失敗確認**
Run: `pnpm test src/lib/sensors/dummy.test.ts`
Expected: FAIL

**Step 3: 実装**
Create `app/src/lib/sensors/dummy.ts`:
```ts
export interface DummySensor { id: string; label: string; min: number; max: number; }

// AIDA64互換IDで主要なものをダミー定義（Phase2でLHM実値に差し替え）
export const DUMMY_SENSORS: DummySensor[] = [
  { id: "SCPUUTI", label: "CPU使用率", min: 0, max: 100 },
  { id: "TCPU", label: "CPU温度", min: 30, max: 95 },
  { id: "SCPUCLK", label: "CPUクロック", min: 800, max: 5200 },
  { id: "SGPU1UTI", label: "GPU使用率", min: 0, max: 100 },
  { id: "TGPU1DIO", label: "GPU温度", min: 30, max: 85 },
  { id: "SMEMUTI", label: "メモリ使用率", min: 0, max: 100 },
];

// 時刻に対して滑らかに揺れる決定的サイン波。乱数を使わずテスト可能に。
export function dummyValue(id: string, timeMs: number): number {
  const s = DUMMY_SENSORS.find((x) => x.id === id);
  if (!s) return NaN;
  const seed = id.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const t = timeMs / 1000;
  const f = (Math.sin(t * 0.6 + seed) + 1) / 2; // 0..1
  return s.min + (s.max - s.min) * f;
}
```

**Step 4: 通過確認**
Run: `pnpm test src/lib/sensors/dummy.test.ts`
Expected: PASS

**Step 5: コミット**
```bash
git add -A && git commit -m "feat: deterministic dummy sensor values"
```

---

## Task 8: Panel ストアと JSON 直列化

**Files:**
- Create: `app/src/lib/editor/store.ts`
- Create: `app/src/lib/editor/store.test.ts`

**Step 1: 失敗するテスト**
Create `app/src/lib/editor/store.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { serializePanel, deserializePanel } from "./store";
import { createPanel, createItem } from "../model/panel";

describe("panel serialization", () => {
  it("round-trips a panel through JSON", () => {
    const p = createPanel(1920, 480);
    p.items.push(createItem("Gauge", { x: 100, y: 100 }));
    p.items.push(createItem("Label", { x: 0, y: 0 }));
    const json = serializePanel(p);
    const back = deserializePanel(json);
    expect(back).toEqual(p);
  });

  it("rejects malformed json instead of silently returning empty", () => {
    expect(() => deserializePanel("{ not json")).toThrow();
    expect(() => deserializePanel('{"size":{}}')).toThrow(); // items 欠落
  });
});
```

**Step 2: 失敗確認**
Run: `pnpm test src/lib/editor/store.test.ts`
Expected: FAIL

**Step 3: 実装**
Create `app/src/lib/editor/store.ts`:
```ts
import type { Panel } from "../model/panel";

export function serializePanel(panel: Panel): string {
  return JSON.stringify(panel, null, 2);
}

// 破損データは握りつぶさず例外を投げる（空フォールバックで上書きしない方針）
export function deserializePanel(json: string): Panel {
  const obj = JSON.parse(json); // 不正JSONはここで throw
  if (!obj || typeof obj !== "object" || !obj.size || !Array.isArray(obj.items)) {
    throw new Error("Invalid panel: missing size or items");
  }
  return obj as Panel;
}
```

**Step 4: 通過確認**
Run: `pnpm test src/lib/editor/store.test.ts`
Expected: PASS

**Step 5: コミット**
```bash
git add -A && git commit -m "feat: panel serialize/deserialize with validation"
```

---

## Task 9: Tauri 保存/読込コマンド（Rust）

**Files:**
- Modify: `app/src-tauri/src/lib.rs`（または `main.rs`。generator版による）
- Modify: `app/src-tauri/Cargo.toml`
- Test: `app/src-tauri/src/lib.rs` 内 `#[cfg(test)]`

**Step 1: 依存追加**
Modify `app/src-tauri/Cargo.toml` の `[dependencies]` に（未記載なら）:
```toml
serde_json = "1"
```
`tauri-plugin-fs` は使わず、コマンドで直接 `std::fs` を使う（パスをアプリ側で固定し最小権限）。

**Step 2: 失敗するテスト＋実装を書く**
Modify `app/src-tauri/src/lib.rs`、コマンドとテストを追加:
```rust
use std::path::PathBuf;

fn panels_dir() -> PathBuf {
    let mut dir = dirs::home_dir().expect("home dir");
    dir.push("PCStatusPanels");
    dir
}

#[tauri::command]
fn save_panel(name: String, json: String) -> Result<(), String> {
    let dir = panels_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{name}.json"));
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_panel(name: String) -> Result<String, String> {
    let path = panels_dir().join(format!("{name}.json"));
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn save_then_load_roundtrips() {
        let name = "test_panel_roundtrip";
        let json = r#"{"size":{"x":0,"y":0,"w":10,"h":10},"items":[]}"#;
        save_panel(name.to_string(), json.to_string()).unwrap();
        let back = load_panel(name.to_string()).unwrap();
        assert_eq!(back, json);
        // cleanup
        let _ = std::fs::remove_file(panels_dir().join(format!("{name}.json")));
    }
}
```
`dirs` クレートを使うため `Cargo.toml` に `dirs = "5"` を追加。
`run()` 内の `invoke_handler` に `save_panel, load_panel` を登録:
```rust
.invoke_handler(tauri::generate_handler![save_panel, load_panel])
```

**Step 3: テスト実行**
Run:
```bash
cd "d:/VSCode/PC Status/app/src-tauri" && cargo test
```
Expected: PASS（save_then_load_roundtrips ok）

**Step 4: コミット**
```bash
git add -A && git commit -m "feat: rust save/load panel commands"
```

---

## Task 10: Konva キャンバスでアイテム描画

**Files:**
- Create: `app/src/lib/render/draw.ts`
- Create: `app/src/lib/render/draw.test.ts`
- Create: `app/src/lib/components/Canvas.svelte`
- Modify: `app/src/App.svelte`

**Step 1: 失敗するテスト（描画ノード生成ロジックを純粋関数化してテスト）**
Create `app/src/lib/render/draw.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { itemDisplayText } from "./draw";
import { createItem } from "../model/panel";

describe("itemDisplayText", () => {
  it("Label shows its format literal", () => {
    const it = createItem("Label", { x: 0, y: 0 });
    it.format = "CPU";
    expect(itemDisplayText(it, NaN)).toBe("CPU");
  });
  it("SensorText formats the live value", () => {
    const it = createItem("SensorText", { x: 0, y: 0 });
    it.format = "%d °C";
    expect(itemDisplayText(it, 75.4)).toBe("75 °C");
  });
});
```

**Step 2: 失敗確認**
Run: `pnpm test src/lib/render/draw.test.ts`
Expected: FAIL

**Step 3: 実装（純粋関数）**
Create `app/src/lib/render/draw.ts`:
```ts
import type { PanelItem } from "../model/panel";
import { formatValue } from "./format";

export function itemDisplayText(item: PanelItem, value: number): string {
  return formatValue(item.format ?? "%d", value);
}
```

**Step 4: 通過確認**
Run: `pnpm test src/lib/render/draw.test.ts`
Expected: PASS

**Step 5: Canvas コンポーネント実装**
Create `app/src/lib/components/Canvas.svelte`:
```svelte
<script lang="ts">
  import { onMount } from "svelte";
  import Konva from "konva";
  import type { Panel, PanelItem } from "../model/panel";
  import { itemDisplayText } from "../render/draw";
  import { valueToFraction, valueToAngle } from "../render/gauge";

  // props (Svelte 5 runes)
  let { panel, values }: { panel: Panel; values: Map<string, number> } = $props();

  let container: HTMLDivElement;
  let stage: Konva.Stage;
  let layer: Konva.Layer;
  const nodes = new Map<string, Konva.Group>();

  function valueFor(item: PanelItem): number {
    return item.sensorSrc ? (values.get(item.sensorSrc) ?? NaN) : NaN;
  }

  function buildNode(item: PanelItem): Konva.Group {
    const g = new Konva.Group({ x: item.rect.x, y: item.rect.y, opacity: item.opacity, id: item.id });
    const v = valueFor(item);
    if (item.kind === "Label" || item.kind === "SensorText") {
      g.add(new Konva.Text({
        text: itemDisplayText(item, v), fontFamily: item.style.fontFamily,
        fontSize: item.style.fontSize, fontStyle: item.style.fontWeight,
        fill: item.style.color, width: item.rect.w, align: item.style.align,
      }));
    } else if (item.kind === "BarH" || item.kind === "BarV") {
      const [min, max] = item.range ?? [0, 100];
      const f = valueToFraction(v, min, max);
      g.add(new Konva.Rect({ width: item.rect.w, height: item.rect.h, stroke: item.style.color }));
      if (item.kind === "BarH")
        g.add(new Konva.Rect({ width: item.rect.w * f, height: item.rect.h, fill: item.style.color }));
      else
        g.add(new Konva.Rect({ y: item.rect.h * (1 - f), width: item.rect.w, height: item.rect.h * f, fill: item.style.color }));
    } else if (item.kind === "Gauge") {
      const [min, max] = item.range ?? [0, 100];
      const r = Math.min(item.rect.w, item.rect.h) / 2;
      g.add(new Konva.Arc({ x: r, y: r, innerRadius: r * 0.7, outerRadius: r, angle: 270, rotation: 135, stroke: "#333", fill: "#222" }));
      const sweep = valueToFraction(v, min, max) * 270;
      g.add(new Konva.Arc({ x: r, y: r, innerRadius: r * 0.7, outerRadius: r, angle: sweep, rotation: 135, fill: item.style.color }));
      g.add(new Konva.Text({ x: 0, y: r - 8, width: r * 2, align: "center", text: itemDisplayText(item, v), fill: item.style.color, fontFamily: item.style.fontFamily, fontSize: item.style.fontSize }));
    }
    return g;
  }

  export function rebuild() {
    layer.destroyChildren();
    nodes.clear();
    for (const item of [...panel.items].sort((a, b) => a.z - b.z)) {
      const node = buildNode(item);
      nodes.set(item.id, node);
      layer.add(node);
    }
    layer.draw();
  }

  // 値だけ更新（構造は維持）: Phase1は簡易に全再構築でも可。負荷が出たら差分化。
  export function refreshValues() {
    rebuild();
  }

  onMount(() => {
    stage = new Konva.Stage({ container, width: panel.size.w, height: panel.size.h });
    layer = new Konva.Layer();
    stage.add(layer);
    rebuild();
  });
</script>

<div bind:this={container} class="canvas" style="width:{panel.size.w}px;height:{panel.size.h}px"></div>

<style>
  .canvas { background: #0a0a0a; }
</style>
```

**Step 6: App.svelte で表示確認**
Modify `app/src/App.svelte`（最小化）:
```svelte
<script lang="ts">
  import Canvas from "./lib/components/Canvas.svelte";
  import { createPanel, createItem } from "./lib/model/panel";

  const panel = createPanel(960, 320);
  const g = createItem("Gauge", { x: 60, y: 60 }); g.sensorSrc = "SCPUUTI"; g.format = "%d%";
  const l = createItem("Label", { x: 240, y: 40 }); l.format = "CPU LOAD";
  panel.items.push(g, l);
  const values = new Map<string, number>([["SCPUUTI", 42]]);
</script>

<Canvas {panel} {values} />
```

**Step 7: 手動確認**
Run: `cd "d:/VSCode/PC Status/app" && pnpm tauri dev`
Expected: 黒背景にゲージ（42%付近まで色が乗る）と "CPU LOAD" ラベルが出る。確認後 Ctrl+C。

**Step 8: コミット**
```bash
git add -A && git commit -m "feat: konva canvas renders label/bar/gauge items"
```

---

## Task 11: ダミー値ループで描画を動かす

**Files:**
- Create: `app/src/lib/sensors/loop.ts`
- Modify: `app/src/App.svelte`

**Step 1: 実装（1秒ごとにダミー値を更新）**
Create `app/src/lib/sensors/loop.ts`:
```ts
import { DUMMY_SENSORS, dummyValue } from "./dummy";

export function startDummyLoop(onTick: (values: Map<string, number>) => void, intervalMs = 1000): () => void {
  const tick = () => {
    const now = performance.now();
    const m = new Map<string, number>();
    for (const s of DUMMY_SENSORS) m.set(s.id, dummyValue(s.id, now));
    onTick(m);
  };
  tick();
  const handle = setInterval(tick, intervalMs);
  return () => clearInterval(handle);
}
```

**Step 2: App.svelte に組み込み**
Modify `app/src/App.svelte`:
```svelte
<script lang="ts">
  import { onMount } from "svelte";
  import Canvas from "./lib/components/Canvas.svelte";
  import { createPanel, createItem } from "./lib/model/panel";
  import { startDummyLoop } from "./lib/sensors/loop";

  const panel = createPanel(960, 320);
  const g = createItem("Gauge", { x: 60, y: 60 }); g.sensorSrc = "SCPUUTI"; g.format = "%d%";
  const t = createItem("SensorText", { x: 240, y: 60 }); t.sensorSrc = "TCPU"; t.format = "%d °C"; t.style.fontSize = 40;
  panel.items.push(g, t);

  let values = $state(new Map<string, number>());
  let canvas: Canvas;

  onMount(() => startDummyLoop((m) => { values = m; canvas?.refreshValues(); }));
</script>

<Canvas bind:this={canvas} {panel} {values} />
```
（`Canvas.svelte` の props を `values` 参照に保つため、`refreshValues` 内で最新 `values` を読むよう、props を `$props()` で受けている前提。Svelte5のリアクティブ反映に問題が出る場合は Canvas 側を `$effect` で `values` 変化時 `rebuild()` する形に変更）

**Step 3: 手動確認**
Run: `pnpm tauri dev`
Expected: ゲージと温度テキストが1秒ごとに滑らかに上下する。

**Step 4: コミット**
```bash
git add -A && git commit -m "feat: dummy sensor loop drives live rendering"
```

---

## Task 12: 選択・移動・リサイズ（Konva Transformer）

**Files:**
- Modify: `app/src/lib/components/Canvas.svelte`

**Step 1: 実装方針**
- 各アイテムの `Konva.Group` を `draggable: true` にする
- クリックで選択 → `Konva.Transformer` をアタッチ（8方向ハンドル）
- `dragend` / `transformend` で `item.rect` をストアへ書き戻し、`snap()` 適用
- 空白クリックで選択解除

**Step 2: Canvas.svelte 変更（要点のみ）**
- `import { snap } from "../editor/snap";` を追加
- `buildNode` の Group に `draggable: true`
- `onMount` 後に Transformer を layer に追加し、`stage.on("click tap", ...)` で選択切替
- ハンドラ:
```ts
let tr: Konva.Transformer;
let onChange: (id: string, rect: {x:number;y:number;w:number;h:number}) => void;
export function setOnChange(cb: typeof onChange) { onChange = cb; }

function select(node: Konva.Group | null) {
  tr.nodes(node ? [node] : []);
  layer.draw();
}

function wireNode(node: Konva.Group, item: PanelItem) {
  node.on("click tap", (e) => { e.cancelBubble = true; select(node); });
  node.on("dragend", () => {
    item.rect.x = snap(node.x(), 5);
    item.rect.y = snap(node.y(), 5);
    node.position({ x: item.rect.x, y: item.rect.y });
    onChange?.(item.id, item.rect);
  });
  node.on("transformend", () => {
    item.rect.w = Math.max(8, node.width() * node.scaleX());
    item.rect.h = Math.max(8, node.height() * node.scaleY());
    node.scale({ x: 1, y: 1 });
    onChange?.(item.id, item.rect);
    rebuild();
  });
}
```
（`buildNode` 内で Group に `width/height` を `item.rect.w/h` で設定し、`wireNode` を呼ぶ。`onMount` で `tr = new Konva.Transformer()` を layer に add。`stage.on("click", e => { if (e.target === stage) select(null); })`）

**Step 3: 手動確認**
Run: `pnpm tauri dev`
Expected: アイテムをクリックでハンドル表示、ドラッグで移動（5pxスナップ）、ハンドルでリサイズできる。空白クリックで選択解除。

**Step 4: コミット**
```bash
git add -A && git commit -m "feat: select/move/resize items with konva transformer"
```

---

## Task 13: パレットでアイテム追加

**Files:**
- Create: `app/src/lib/components/Palette.svelte`
- Modify: `app/src/App.svelte`

**Step 1: 実装**
Create `app/src/lib/components/Palette.svelte`:
```svelte
<script lang="ts">
  import type { ItemKind } from "../model/panel";
  let { onAdd }: { onAdd: (kind: ItemKind) => void } = $props();
  const kinds: ItemKind[] = ["Label", "SensorText", "Gauge", "BarH", "BarV"];
</script>

<div class="palette">
  {#each kinds as k}
    <button onclick={() => onAdd(k)}>{k}</button>
  {/each}
</div>

<style>
  .palette { display: flex; flex-direction: column; gap: 4px; padding: 8px; background: #161616; }
  button { padding: 6px; }
</style>
```

**Step 2: App.svelte に統合**
Modify `app/src/App.svelte`: パレットの `onAdd` で `createItem(kind, {x:40,y:40})` を `panel.items` に push → `canvas.rebuild()`。

**Step 3: 手動確認**
Run: `pnpm tauri dev`
Expected: パレットのボタンを押すとキャンバスに対応アイテムが追加される。

**Step 4: コミット**
```bash
git add -A && git commit -m "feat: palette adds items to canvas"
```

---

## Task 14: プロパティパネル（フォント独立・色・min/max・format・センサー割当）

**Files:**
- Create: `app/src/lib/components/Properties.svelte`
- Modify: `app/src/App.svelte`

**Step 1: 実装**
Create `app/src/lib/components/Properties.svelte`:
```svelte
<script lang="ts">
  import type { PanelItem } from "../model/panel";
  import { DUMMY_SENSORS } from "../sensors/dummy";
  let { item, onChange }: { item: PanelItem | null; onChange: () => void } = $props();
</script>

{#if item}
  <div class="props">
    <label>X <input type="number" bind:value={item.rect.x} oninput={onChange} /></label>
    <label>Y <input type="number" bind:value={item.rect.y} oninput={onChange} /></label>
    <label>W <input type="number" bind:value={item.rect.w} oninput={onChange} /></label>
    <label>H <input type="number" bind:value={item.rect.h} oninput={onChange} /></label>
    <label>不透明度 <input type="range" min="0" max="1" step="0.05" bind:value={item.opacity} oninput={onChange} /></label>
    <label>フォント
      <select bind:value={item.style.fontFamily} onchange={onChange}>
        <option>sans-serif</option><option>monospace</option><option>Orbitron</option><option>Meiryo</option>
      </select>
    </label>
    <label>サイズ <input type="number" bind:value={item.style.fontSize} oninput={onChange} /></label>
    <label>太字 <input type="checkbox" checked={item.style.fontWeight === "bold"}
      onchange={(e) => { item.style.fontWeight = (e.target as HTMLInputElement).checked ? "bold" : "normal"; onChange(); }} /></label>
    <label>色 <input type="color" bind:value={item.style.color} oninput={onChange} /></label>
    <label>format <input bind:value={item.format} oninput={onChange} /></label>
    {#if item.range}
      <label>min <input type="number" bind:value={item.range[0]} oninput={onChange} /></label>
      <label>max <input type="number" bind:value={item.range[1]} oninput={onChange} /></label>
    {/if}
    <label>センサー
      <select bind:value={item.sensorSrc} onchange={onChange}>
        <option value={undefined}>(なし)</option>
        {#each DUMMY_SENSORS as s}<option value={s.id}>{s.label}</option>{/each}
      </select>
    </label>
  </div>
{:else}
  <div class="props muted">アイテムを選択</div>
{/if}

<style>
  .props { display: flex; flex-direction: column; gap: 4px; padding: 8px; background: #161616; color: #ccc; width: 200px; }
  .muted { opacity: 0.5; }
  label { display: flex; justify-content: space-between; gap: 6px; font-size: 12px; }
</style>
```
**フォント独立の確認**: `item.style.fontFamily` は選択中アイテムのみを書き換える（全体設定にしない）。

**Step 2: App.svelte で選択アイテムを Properties に渡し、変更時 `canvas.rebuild()`**
- Canvas の `setOnChange` / 選択イベントから「選択中の PanelItem」を App の `$state` に反映
- Properties の `onChange` で `canvas.rebuild()`

**Step 3: 手動確認**
Run: `pnpm tauri dev`
Expected: アイテムを選択しプロパティを変えると即反映。2つのテキストに別フォント/別サイズ/別色を設定でき、互いに影響しない。

**Step 4: コミット**
```bash
git add -A && git commit -m "feat: properties panel with per-item font and sensor binding"
```

---

## Task 15: 保存/読込のUI配線（Rustコマンド呼び出し）

**Files:**
- Modify: `app/src/App.svelte`
- Create: `app/src/lib/editor/persist.ts`

**Step 1: 実装**
Create `app/src/lib/editor/persist.ts`:
```ts
import { invoke } from "@tauri-apps/api/core";
import type { Panel } from "../model/panel";
import { serializePanel, deserializePanel } from "./store";

export async function savePanel(name: string, panel: Panel): Promise<void> {
  await invoke("save_panel", { name, json: serializePanel(panel) });
}

export async function loadPanel(name: string): Promise<Panel> {
  const json = await invoke<string>("load_panel", { name });
  return deserializePanel(json); // 破損時は throw（呼び出し側で表示）
}
```

**Step 2: App.svelte に保存/読込ボタン**
- 「保存」ボタン → `savePanel("default", panel)`
- 「読込」ボタン → `panel = await loadPanel("default")` → `canvas.rebuild()`
- 失敗時は `try/catch` でエラーメッセージを画面表示（握りつぶさない）

**Step 3: 手動確認**
Run: `pnpm tauri dev`
Expected: アイテムを配置→保存→アプリ再起動→読込で同じ配置が復元される。`~/PCStatusPanels/default.json` が生成される。

**Step 4: コミット**
```bash
git add -A && git commit -m "feat: save/load panel via tauri commands"
```

---

## Phase 1 完了条件（受け入れ確認）

Run（全ユニットテスト）:
```bash
cd "d:/VSCode/PC Status/app" && pnpm test
cd "d:/VSCode/PC Status/app/src-tauri" && cargo test
```
Expected: すべて PASS

手動確認チェックリスト:
- [ ] パレットから Label/SensorText/Gauge/BarH/BarV を追加できる
- [ ] 選択→ドラッグ移動（スナップ）→ハンドルでリサイズできる
- [ ] プロパティで色・フォント・サイズ・min/max・format・センサーを変更でき即反映
- [ ] 2つのテキストが別フォントで独立する
- [ ] ダミー値で1秒ごとにゲージ/バー/テキストが動く
- [ ] 保存→再起動→読込でレイアウトが復元する
- [ ] 不正/破損JSON読込時にエラー表示され、空で上書きされない

完了後の次フェーズ: Phase 1.5（アセットライブラリ・透過PNG・画像ゲージ・背景画像）。

---

## 留意点（実装中に守る）

- **YAGNI**: GraphLine / Image / 画像ゲージ / Undo-Redo は Phase1 では作らない（設計書通り次フェーズ）。ただし型 (`ItemKind`, `GaugeRender`) には将来分を残してある。
- **DRY**: 値→表示文字列は `itemDisplayText` / `formatValue` に一本化。複数箇所でフォーマットしない。
- **エラー握りつぶし禁止**: `deserializePanel` と保存/読込の失敗は必ず可視化。
- Svelte5 の runes（`$props`, `$state`, `$effect`）前提。generator が Svelte4 を入れた場合は `$:` 構文へ読み替えるか Svelte5 へ更新。
