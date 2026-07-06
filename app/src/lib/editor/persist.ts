import { invoke } from "@tauri-apps/api/core";
import type { Panel, PanelItem } from "$lib/model/panel";
import { serializePanel, deserializePanel } from "./store";

// アセットパスの可搬化：保存は Assets 基準の相対（"assets:pack/..."）で書き、
// 読込は実行中PCの Assets ルートで絶対化する。これで別PC（配布先）でも解決できる。
const SENTINEL = "assets:";
let _rootCache = "";
async function assetsRoot(): Promise<string> {
  if (!_rootCache) {
    try { _rootCache = await invoke<string>("assets_root"); } catch { _rootCache = ""; }
  }
  return _rootCache.replace(/[/\\]+$/, "");
}

// 絶対パス → 保存用相対。Assets セグメント以降を取り出す。該当なしは素通し。
function toStorage(path: string, root: string): string {
  if (!path || path.startsWith(SENTINEL)) return path;
  const norm = path.replace(/\\/g, "/");
  const r = root.replace(/\\/g, "/");
  if (r && norm.toLowerCase().startsWith(r.toLowerCase() + "/")) return SENTINEL + norm.slice(r.length + 1);
  const m = norm.match(/\/Assets\/(.+)$/i); // ルート不一致でも Assets 以降で救済
  return m ? SENTINEL + m[1] : path;
}

// 保存用相対（または旧来の絶対）→ 実行中PCの絶対パス。
function fromStorage(path: string, root: string): string {
  if (!path) return path;
  const sep = root.includes("\\") ? "\\" : "/";
  const join = (rel: string) => root.replace(/[/\\]+$/, "") + sep + rel.replace(/[/\\]+/g, sep);
  if (path.startsWith(SENTINEL)) return join(path.slice(SENTINEL.length));
  const m = path.replace(/\\/g, "/").match(/\/Assets\/(.+)$/i); // 旧絶対パスを現ルートへ再ホーム
  return m ? join(m[1]) : path;
}

// パネル内の全アセット参照（背景・画像・ゲージ各種）にマップ関数を適用する。
function remapAssets(panel: Panel, fn: (p: string) => string): Panel {
  if (panel.background) panel.background = fn(panel.background);
  for (const it of (panel.items ?? []) as PanelItem[]) {
    if (it.asset) it.asset = fn(it.asset);
    const g = it.gauge as Record<string, unknown> | undefined;
    if (g) {
      if (typeof g.needleAsset === "string") g.needleAsset = fn(g.needleAsset);
      if (typeof g.dialAsset === "string") g.dialAsset = fn(g.dialAsset);
      if (typeof g.spriteAsset === "string") g.spriteAsset = fn(g.spriteAsset);
      if (Array.isArray(g.frames)) g.frames = (g.frames as string[]).map(fn);
    }
  }
  return panel;
}

export async function savePanel(name: string, panel: Panel): Promise<void> {
  const root = await assetsRoot();
  const portable = remapAssets(structuredClone(panel), (p) => toStorage(p, root)); // ライブ状態は変えずクローンを保存
  await invoke("save_panel", { name, json: serializePanel(portable) });
}

export async function loadPanel(name: string): Promise<Panel> {
  const json = await invoke<string>("load_panel", { name });
  const panel = deserializePanel(json); // 破損時は throw（呼び出し側で表示）
  const root = await assetsRoot();
  return remapAssets(panel, (p) => fromStorage(p, root));
}

// 保存済みパネル名の一覧（PCStatusPanels内の *.json）
export async function listPanels(): Promise<string[]> {
  return invoke<string[]>("list_panels");
}
