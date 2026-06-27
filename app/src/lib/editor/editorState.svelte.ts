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
  }
}

export const editor = new EditorState();
