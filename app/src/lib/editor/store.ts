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
