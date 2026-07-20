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

// リセット時刻(epoch ms)を「残り時間」表示にする。format 中の "%t" を残り時間へ置換する。
// 値はセンサー経由でエポックms が渡り、毎tickで now と差分するため生きたカウントダウンになる。
export function isCountdownFormat(format: string | undefined): boolean {
  return !!format && format.includes("%t");
}

export function humanizeRemaining(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0m";
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

export function formatCountdown(format: string, epochMs: number): string {
  if (!Number.isFinite(epochMs) || epochMs <= 0) return format.replace("%t", "—");
  return format.replace("%t", humanizeRemaining(epochMs - Date.now()));
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
