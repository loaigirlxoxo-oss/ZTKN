import { createPanel, createItem, type Panel, type PanelItem, type ItemKind } from "$lib/model/panel";

// Svelte5 runes を使うアプリ全体の編集状態（単一の真実）
class EditorState {
  panel = $state<Panel>(createPanel(960, 360));
  selectedId = $state<string | null>(null);
  values = $state<Map<string, number>>(new Map());
  // 折れ線グラフ用の履歴リングバッファ（センサーIDごと）。描画は values 更新時に行うため非リアクティブで保持。
  readonly historyLen = 120;
  history = new Map<string, number[]>();
  // 構造変更（追加/削除/プロパティ変更/リサイズ）を Konva 再描画へ伝える手動トリガ
  structureVersion = $state(0);

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

  get selected(): PanelItem | null {
    return this.panel.items.find((i) => i.id === this.selectedId) ?? null;
  }

  addItem(kind: ItemKind): void {
    const item = createItem(kind, { x: 40, y: 40 });
    this.panel.items.push(item);
    this.selectedId = item.id;
    this.bumpStructure();
  }

  deleteSelected(): void {
    if (!this.selectedId) return;
    this.panel.items = this.panel.items.filter((i) => i.id !== this.selectedId);
    this.selectedId = null;
    this.bumpStructure();
  }

  setValues(m: Map<string, number>): void {
    // 履歴へ追記（values を更新する前に行い、描画時に最新が読めるようにする）
    for (const [k, v] of m) {
      let arr = this.history.get(k);
      if (!arr) { arr = []; this.history.set(k, arr); }
      arr.push(v);
      if (arr.length > this.historyLen) arr.shift();
    }
    this.values = m;
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

  // --- 矢印キー微調整 ---
  nudge(dx: number, dy: number): void {
    const it = this.selected;
    if (!it) return;
    it.rect.x += dx;
    it.rect.y += dy;
    this.bumpStructure();
  }
}

export const editor = new EditorState();
