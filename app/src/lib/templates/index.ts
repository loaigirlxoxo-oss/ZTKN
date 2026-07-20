import type { Panel } from "$lib/model/panel";
import { buildDefaultTemplate } from "./default";
import { buildNeonTemplate } from "./neon";
import { buildMinimalTemplate } from "./minimal";
import { buildDenseTemplate } from "./dense";

export interface Template { name: string; build: () => Panel; }

// 追加するテンプレはここに登録するだけでドロップダウンに出る。先頭が起動時の既定。
export const templates: Template[] = [
  { name: "Default（標準）", build: buildDefaultTemplate },
  { name: "Neon（ゲージ＋グラフ）", build: buildNeonTemplate },
  { name: "Minimal（数値中心）", build: buildMinimalTemplate },
  { name: "Dense（コアびっしり）", build: buildDenseTemplate },
];
