import { invoke } from "@tauri-apps/api/core";

export interface AssetSet { name: string; files: string[]; }

// Assets/ を読むだけ。アプリは中身を一切いじらない（コピー・並べ替え・生成なし）。
// ユーザーがエクスプローラでセットを置き、ここは一覧表示と「開く」だけを担う。
class AssetLibrary {
  sets = $state<AssetSet[]>([]);
  msg = $state("");

  async refresh(): Promise<void> {
    try {
      this.sets = await invoke<AssetSet[]>("list_asset_sets");
      this.msg = `${this.sets.length} セット`;
    } catch (e) {
      this.msg = "読込失敗: " + e;
    }
  }

  async openFolder(): Promise<void> {
    try {
      await invoke("open_assets_dir");
    } catch (e) {
      this.msg = "フォルダを開けません: " + e;
    }
  }
}

export const library = new AssetLibrary();
