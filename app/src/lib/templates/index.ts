import type { Panel } from "$lib/model/panel";
import { buildNeonTemplate } from "./neon";
import { buildMinimalTemplate } from "./minimal";

export interface Template { name: string; build: () => Panel; }

// 追加するテンプレはここに登録するだけでドロップダウンに出る
export const templates: Template[] = [
  { name: "Neon（ゲージ＋グラフ）", build: buildNeonTemplate },
  { name: "Minimal（数値中心）", build: buildMinimalTemplate },
];
