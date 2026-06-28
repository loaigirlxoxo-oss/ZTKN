// 対応トークン: %d, %.<n>f, %f。1トークンのみ置換する素朴実装。
const TOKEN = /%(?:\.(\d+))?([df])/;

// センサーの単位から表示フォーマットを決める（℃/%/W等を手で書かなくて済む）。
export function formatForUnit(unit: string | undefined): string {
  if (!unit) return "%d";
  if (unit === "%") return "%d%";
  if (unit === "V") return "%.2f V"; // 電圧は小数
  return `%d ${unit}`;
}

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
