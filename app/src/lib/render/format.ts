// 対応トークン: %d, %.<n>f, %f。1トークンのみ置換する素朴実装。
const TOKEN = /%(?:\.(\d+))?([df])/;

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
