// 対応トークン: %d, %.<n>f, %f。1トークンのみ置換する素朴実装。
const TOKEN = /%(?:\.(\d+))?([df])/;

// フォーマットを「接頭辞 / 数値トークン / 単位(接尾辞)」に分割する。
// 単位を固定位置で描くために使う（トークンが無ければ null）。
export function splitFormat(format: string): { prefix: string; token: string; suffix: string } | null {
  const m = format.match(TOKEN);
  if (!m || m.index === undefined) return null;
  return {
    prefix: format.slice(0, m.index),
    token: m[0],
    suffix: format.slice(m.index + m[0].length),
  };
}

export function formatValue(format: string, value: number): string {
  const m = format.match(TOKEN);
  if (!m) return format; // トークンなし=リテラル（Labelなど）
  const finite = Number.isFinite(value);
  let text: string;
  if (!finite) {
    text = "--";
  } else if (m[2] === "d") {
    text = String(Math.round(value));
  } else {
    const digits = m[1] !== undefined ? Number(m[1]) : 6;
    text = value.toFixed(digits);
  }
  return format.replace(TOKEN, text);
}
