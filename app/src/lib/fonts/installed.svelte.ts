import { invoke } from "@tauri-apps/api/core";
import { editor } from "$lib/editor/editorState.svelte";

// 取得失敗時の最低限の一覧（Windows標準で視認差が大きいもの）
const FALLBACK = ["Segoe UI", "Arial", "Consolas", "Times New Roman", "Comic Sans MS", "Impact", "Meiryo", "MS Gothic"];

// Windows にインストール済みのフォントファミリ一覧。Rust から1回だけ取得する。
export const fontStore = $state<{ list: string[]; loaded: boolean }>({ list: FALLBACK, loaded: false });

// CSS 文字列用エスケープ（フォント名の " と \ ）
function cssStr(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// 各フォント名に @font-face(local) を張る。canvas は基本「ファミリ名」でしか探せず、
// "游ゴシック Light" / "Bahnschrift SemiBold" 等のウェイト派生ファミリはそのままだと描画されない。
// local() はフルネーム/PostScript名でも一致するので、これで一覧の全フォントが描画対象になる。
// bold を潰さないよう normal と bold(700) の2面（bold は "X Bold" を試し無ければ faux）。
// ※実際に canvas で使うには document.fonts.load でのロードも要る（CanvasStage 側で実施）。
function injectFamilyFaces(names: string[]): void {
  if (typeof document === "undefined") return;
  let css = "";
  for (const name of names) {
    const e = cssStr(name);
    css += `@font-face{font-family:"${e}";src:local("${e}")}`;
    css += `@font-face{font-family:"${e}";font-weight:700;src:local("${e} Bold"),local("${e}")}`;
  }
  let el = document.getElementById("ztkn-font-faces") as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = "ztkn-font-faces";
    document.head.appendChild(el);
  }
  el.textContent = css;
}

let started = false;
export async function ensureFonts(): Promise<void> {
  if (started) return; // 多重取得を防止
  started = true;
  injectFamilyFaces(fontStore.list); // まず FALLBACK 分
  try {
    const names = await invoke<string[]>("list_fonts");
    if (names && names.length) {
      fontStore.list = names;
      fontStore.loaded = true;
      injectFamilyFaces(names); // 全フォントを @font-face(local) 登録
      editor.bumpStructure();
    }
  } catch {
    // 取得失敗時は FALLBACK のまま
  }
}
