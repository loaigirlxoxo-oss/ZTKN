import { createPanel, createItem, type Panel, type PanelItem, type ItemKind } from "$lib/model/panel";

// Svelte5 runes を使うアプリ全体の編集状態（単一の真実）
class EditorState {
  panel = $state<Panel>(createPanel(960, 360));
  selectedIds = $state<string[]>([]); // 複数選択。selectedId は最後＝主選択
  values = $state<Map<string, number>>(new Map());
  // ハード名を除いた name|type での索引。保存パネルが別PCの型番(例:RTX5080固定)でも、
  // 完全一致しなければ name|type で拾えるようにする＝プリセットを機種非依存にする。
  valuesByNameType = $state<Map<string, number>>(new Map());
  // 折れ線グラフ用の履歴リングバッファ（センサーIDごと）。描画は values 更新時に行うため非リアクティブで保持。
  readonly historyLen = 120;
  history = new Map<string, number[]>();
  historyByNameType = new Map<string, number[]>();
  // 構造変更（追加/削除/プロパティ変更/リサイズ）を Konva 再描画へ伝える手動トリガ
  structureVersion = $state(0);
  // 表示倍率（キャンバスの見た目ズーム。パネル座標は不変）
  zoom = $state(1);

  // Undo/Redo（パネルのJSONスナップショット履歴）
  canUndo = $state(false);
  canRedo = $state(false);
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private current = "";
  private lastSnapAt = 0;
  private restoring = false;
  private clipboard: PanelItem | null = null;
  private idc = 0;

  // 主選択（最後にクリックした1つ）。既存コードとの互換のため getter/setter を維持。
  get selectedId(): string | null {
    return this.selectedIds.length ? this.selectedIds[this.selectedIds.length - 1] : null;
  }
  set selectedId(id: string | null) {
    this.selectedIds = id ? [id] : [];
  }

  get selected(): PanelItem | null {
    return this.panel.items.find((i) => i.id === this.selectedId) ?? null;
  }

  get selectedItems(): PanelItem[] {
    return this.panel.items.filter((i) => this.selectedIds.includes(i.id));
  }

  // --- 選択操作 ---
  selectOnly(id: string): void { this.selectedIds = [id]; }
  clearSelection(): void { this.selectedIds = []; }
  toggleSelect(id: string): void {
    this.selectedIds = this.selectedIds.includes(id)
      ? this.selectedIds.filter((x) => x !== id)
      : [...this.selectedIds, id];
  }
  selectMany(ids: string[]): void { this.selectedIds = [...ids]; }

  addItem(kind: ItemKind): void {
    const item = createItem(kind, { x: 40, y: 40 });
    this.panel.items.push(item);
    this.selectedId = item.id;
    this.bumpStructure();
  }

  deleteSelected(): void {
    if (!this.selectedIds.length) return;
    const ids = new Set(this.selectedIds);
    this.panel.items = this.panel.items.filter((i) => !ids.has(i.id));
    this.selectedIds = [];
    this.bumpStructure();
  }

  // 合成キー hw|name|type から、ハード名を除いた name|type を得る
  private nameType(id: string): string {
    const i = id.indexOf("|");
    return i >= 0 ? id.substring(i + 1) : id;
  }
  private pushHist(map: Map<string, number[]>, key: string, v: number): void {
    let arr = map.get(key);
    if (!arr) { arr = []; map.set(key, arr); }
    arr.push(v);
    if (arr.length > this.historyLen) arr.shift();
  }

  // 値解決：完全一致 → name|type フォールバック（別機種のプリセットでも拾う）
  valueOf(id: string): number | undefined {
    const v = this.values.get(id);
    return v !== undefined ? v : this.valuesByNameType.get(this.nameType(id));
  }
  historyOf(id: string): number[] {
    return this.history.get(id) ?? this.historyByNameType.get(this.nameType(id)) ?? [];
  }

  setValues(m: Map<string, number>): void {
    // 履歴へ追記（values を更新する前に行い、描画時に最新が読めるようにする）
    const byNT = new Map<string, number>();
    for (const [k, v] of m) {
      this.pushHist(this.history, k, v);
      byNT.set(this.nameType(k), v); // 同 name|type が複数あれば後勝ち（単機はまず衝突しない）
    }
    for (const [nt, v] of byNT) this.pushHist(this.historyByNameType, nt, v); // 履歴は name|type ごと1回
    this.values = m;
    this.valuesByNameType = byNT;
  }

  replacePanel(panel: Panel): void {
    this.panel = panel;
    this.selectedId = null;
    this.bumpStructure();
  }

  bumpStructure(): void {
    this.structureVersion += 1;
    if (!this.restoring) this.recordHistory();
  }

  // --- Undo/Redo ---
  private recordHistory(): void {
    const snap = JSON.stringify(this.panel);
    if (this.current === "") { this.current = snap; this.lastSnapAt = performance.now(); return; }
    if (snap === this.current) return;
    const now = performance.now();
    if (now - this.lastSnapAt > 500) {
      // 500ms以上空いた変化＝新しいUndoステップ。連続(ドラッグ/タイプ)はまとめる
      this.undoStack.push(this.current);
      if (this.undoStack.length > 100) this.undoStack.shift();
      this.redoStack = [];
    }
    this.current = snap;
    this.lastSnapAt = now;
    this.syncFlags();
  }

  private syncFlags(): void {
    this.canUndo = this.undoStack.length > 0;
    this.canRedo = this.redoStack.length > 0;
  }

  private restore(snap: string): void {
    this.restoring = true;
    this.panel = JSON.parse(snap);
    this.selectedId = null;
    this.current = snap;
    this.structureVersion += 1;
    this.restoring = false;
    this.syncFlags();
  }

  undo(): void {
    if (!this.undoStack.length) return;
    this.redoStack.push(this.current);
    this.restore(this.undoStack.pop()!);
  }

  redo(): void {
    if (!this.redoStack.length) return;
    this.undoStack.push(this.current);
    this.restore(this.redoStack.pop()!);
  }

  // --- 複製 / コピー&ペースト ---
  private cloneItem(it: PanelItem): PanelItem {
    const c = JSON.parse(JSON.stringify(it)) as PanelItem;
    c.id = `dup_${++this.idc}_${Math.floor(performance.now())}`;
    return c;
  }

  duplicateSelected(): void {
    const it = this.selected;
    if (!it) return;
    const c = this.cloneItem(it);
    c.rect.x += 16; c.rect.y += 16;
    this.panel.items.push(c);
    this.selectedId = c.id;
    this.bumpStructure();
  }

  copySelected(): void {
    const it = this.selected;
    if (it) this.clipboard = JSON.parse(JSON.stringify(it));
  }

  paste(): void {
    if (!this.clipboard) return;
    const c = this.cloneItem(this.clipboard);
    c.rect.x += 16; c.rect.y += 16;
    this.panel.items.push(c);
    this.selectedId = c.id;
    this.bumpStructure();
  }

  // --- z順 ---
  bringToFront(): void {
    const it = this.selected;
    if (!it) return;
    it.z = Math.max(...this.panel.items.map((i) => i.z)) + 1;
    this.bumpStructure();
  }

  sendToBack(): void {
    const it = this.selected;
    if (!it) return;
    it.z = Math.min(...this.panel.items.map((i) => i.z)) - 1;
    this.bumpStructure();
  }

  // --- 矢印キー微調整（選択全部を移動）---
  nudge(dx: number, dy: number): void {
    const items = this.selectedItems;
    if (!items.length) return;
    for (const it of items) { it.rect.x += dx; it.rect.y += dy; }
    this.bumpStructure();
  }

  // --- 整列（選択2つ以上を、選択範囲のバウンディングボックス基準で揃える）---
  align(edge: "left" | "centerX" | "right" | "top" | "centerY" | "bottom"): void {
    const items = this.selectedItems;
    if (items.length < 2) return;
    const minX = Math.min(...items.map((i) => i.rect.x));
    const maxX = Math.max(...items.map((i) => i.rect.x + i.rect.w));
    const minY = Math.min(...items.map((i) => i.rect.y));
    const maxY = Math.max(...items.map((i) => i.rect.y + i.rect.h));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    for (const it of items) {
      switch (edge) {
        case "left": it.rect.x = minX; break;
        case "centerX": it.rect.x = Math.round(cx - it.rect.w / 2); break;
        case "right": it.rect.x = maxX - it.rect.w; break;
        case "top": it.rect.y = minY; break;
        case "centerY": it.rect.y = Math.round(cy - it.rect.h / 2); break;
        case "bottom": it.rect.y = maxY - it.rect.h; break;
      }
    }
    this.bumpStructure();
  }

  // --- 等間隔配置（選択3つ以上を、中心が等間隔になるよう並べる）---
  distribute(axis: "x" | "y"): void {
    const items = this.selectedItems;
    if (items.length < 3) return;
    const center = (i: PanelItem) => (axis === "x" ? i.rect.x + i.rect.w / 2 : i.rect.y + i.rect.h / 2);
    const sorted = [...items].sort((a, b) => center(a) - center(b));
    const first = center(sorted[0]), last = center(sorted[sorted.length - 1]);
    const step = (last - first) / (sorted.length - 1);
    sorted.forEach((it, idx) => {
      const target = first + step * idx;
      if (axis === "x") it.rect.x = Math.round(target - it.rect.w / 2);
      else it.rect.y = Math.round(target - it.rect.h / 2);
    });
    this.bumpStructure();
  }
}

export const editor = new EditorState();
