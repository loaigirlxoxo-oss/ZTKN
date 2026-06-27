import { listen } from "@tauri-apps/api/event";
import { editor } from "$lib/editor/editorState.svelte";

export interface LiveSensor { id: string; name: string; hw: string; type: string; unit: string; }
interface RawSensor extends LiveSensor { value: number; }

// サイドカー(LHM)からの実センサーをフロントへ取り込むハブ。
// "sensors" イベント(JSON)を受けて editor へ値を流し、センサー一覧を保持する。
class SensorHub {
  list = $state<LiveSensor[]>([]);
  status = $state<string>("起動中…");
  private started = false;
  private onReady: ((list: LiveSensor[]) => void) | null = null;

  // 最初に一覧が揃ったとき一度だけ呼ぶコールバック（サンプルの自動割当に使う）
  whenReady(cb: (list: LiveSensor[]) => void): void {
    if (this.list.length > 0) cb(this.list);
    else this.onReady = cb;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await listen<string>("sensors", (e) => {
      let payload: { sensors: RawSensor[] };
      try {
        payload = JSON.parse(e.payload);
      } catch {
        return;
      }
      const m = new Map<string, number>();
      for (const s of payload.sensors) m.set(s.id, s.value);
      editor.setValues(m);
      // 一覧は出入りがあったときだけ更新（名前・単位は安定）
      if (payload.sensors.length !== this.list.length) {
        this.list = payload.sensors.map((s) => ({ id: s.id, name: s.name, hw: s.hw, type: s.type, unit: s.unit }));
      }
      this.status = `接続済み (${this.list.length} センサー)`;
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
