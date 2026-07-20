// テキスト系（SensorText/DateTime）の「箱内での値ブロック開始X」を整列から純粋計算する。
// 箱幅 containerW は固定（リサイズで決めた値）。値の桁が増減しても箱は動かさず、
// この式で左/中央/右へ配置する＝整列が箱サイズに依存せず必ず効く。
// 中央/右で block が箱より広い場合は 0 にクランプ（左端固定）。
export function blockStartX(
  containerW: number,
  blockW: number,
  align: "left" | "center" | "right",
): number {
  if (align === "right") return Math.max(0, containerW - blockW);
  if (align === "center") return Math.max(0, Math.round((containerW - blockW) / 2));
  return 0;
}
