import { listen } from "@tauri-apps/api/event";
import { editor } from "$lib/editor/editorState.svelte";

export interface LiveSensor { id: string; name: string; hw: string; type: string; unit: string; }
interface RawSensor extends LiveSensor { value: number; }

const CATALOG_KEY = "sensor-catalog-v3"; // 一度見たセンサーを記憶（ピッカー用）。v3=合成キーID方式（旧版の混入を一掃）
const OLD_KEYS = ["sensor-catalog-v1", "sensor-catalog-v2"]; // 旧ID方式の残骸。読まない＆掃除する
const hasLS = typeof localStorage !== "undefined";

// サイドカー(LHM)からの実センサーをフロントへ取り込むハブ。
// "sensors" イベント(JSON)を受けて editor へ値を流し、センサーのカタログ（一度見たら消えない）を保持する。
class SensorHub {
  list = $state<LiveSensor[]>([]);
  status = $state<string>("起動中…");
  private started = false;
  private onReady: ((list: LiveSensor[]) => void) | null = null;
  // 一度でも観測したセンサーを残すカタログ。瞬間的に値が欠けても一覧から消えないようにする。
  private catalog = new Map<string, LiveSensor>();

  constructor() {
    // 前回のカタログを復元（emit前や欠落中でもピッカーに全件出す＝「見えるものだけ」を解消）
    if (hasLS) {
      for (const k of OLD_KEYS) { try { localStorage.removeItem(k); } catch { /* 無視 */ } } // 旧版を掃除
      try {
        const raw = localStorage.getItem(CATALOG_KEY);
        if (raw) {
          for (const s of JSON.parse(raw) as LiveSensor[]) this.catalog.set(s.id, s);
          if (this.catalog.size) this.list = this.sorted();
        }
      } catch { /* 壊れていたら無視して空から */ }
    }
  }

  private sorted(): LiveSensor[] {
    return [...this.catalog.values()].sort((a, b) => a.hw.localeCompare(b.hw) || a.name.localeCompare(b.name));
  }

  private persist(): void {
    if (!hasLS) return;
    try { localStorage.setItem(CATALOG_KEY, JSON.stringify([...this.catalog.values()])); } catch { /* 容量超過等は無視 */ }
  }

  // カタログを空にして次tickから作り直す（ハード変更や旧データ掃除用）
  clearCatalog(): void {
    this.catalog.clear();
    this.list = [];
    if (hasLS) { try { localStorage.removeItem(CATALOG_KEY); } catch { /* 無視 */ } }
  }

  // 最初に一覧が揃ったとき一度だけ呼ぶコールバック（サンプルの自動割当に使う）
  whenReady(cb: (list: LiveSensor[]) => void): void {
    if (this.list.length > 0) cb(this.list);
    else this.onReady = cb;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await listen<string>("sensors", (e) => {
      let payload: { source: string; sensors: RawSensor[] };
      try {
        payload = JSON.parse(e.payload);
      } catch {
        return;
      }
      const m = new Map<string, number>();
      let grew = false;
      for (const s of payload.sensors) {
        m.set(s.id, s.value);
        if (!this.catalog.has(s.id)) {
          this.catalog.set(s.id, { id: s.id, name: s.name, hw: s.hw, type: s.type, unit: s.unit });
          grew = true;
        }
      }
      editor.setValues(m);
      // カタログに新顔が増えたときだけ一覧を作り直して保存（毎tickの再構築を避ける）
      if (grew) { this.list = this.sorted(); this.persist(); }
      this.status = `${payload.source ?? "?"} / ${payload.sensors.length} 値 / カタログ ${this.catalog.size}`;
      if (this.onReady && this.list.length > 0) {
        const cb = this.onReady;
        this.onReady = null;
        cb(this.list);
      }
    });
    await listen<string>("sensor-status", (e) => {
      if (e.payload === "connected") this.status = "接続済み";
      else if (e.payload === "disconnected") this.status = "切断（再接続中…）";
      else this.status = e.payload;
    });
  }
}

export const sensors = new SensorHub();
