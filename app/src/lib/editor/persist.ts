import { invoke } from "@tauri-apps/api/core";
import type { Panel } from "$lib/model/panel";
import { serializePanel, deserializePanel } from "./store";

export async function savePanel(name: string, panel: Panel): Promise<void> {
  await invoke("save_panel", { name, json: serializePanel(panel) });
}

export async function loadPanel(name: string): Promise<Panel> {
  const json = await invoke<string>("load_panel", { name });
  return deserializePanel(json); // 破損時は throw（呼び出し側で表示）
}
