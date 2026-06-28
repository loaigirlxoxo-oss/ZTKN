import { invoke } from "@tauri-apps/api/core";

export interface AssetSet { name: string; files: string[]; }

// exe隣の Assets/ をライブラリとして扱う。取り込み（コピー）と一覧取得を提供。
class AssetLibrary {
  sets = $state<AssetSet[]>([]);
  loading = $state(false);
  msg = $state("");

  async refresh(): Promise<void> {
    this.sets = await invoke<AssetSet[]>("list_asset_sets");
  }

  async openFolder(): Promise<void> {
    try {
      await invoke("open_assets_dir");
    } catch (e) {
      this.msg = "フォルダを開けません: " + e;
    }
  }

  async importAida64(root: string): Promise<void> {
    this.loading = true;
    this.msg = "取込中…";
    try {
      const created = await invoke<string[]>("import_aida64_pack", { srcRoot: root });
      await this.refresh();
      this.msg = `${created.length} セット取込`;
    } catch (e) {
      this.msg = "取込失敗: " + e;
    } finally {
      this.loading = false;
    }
  }
}

export const library = new AssetLibrary();
