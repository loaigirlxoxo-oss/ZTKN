import { invoke } from "@tauri-apps/api/core";

// 出力音声のループバック取り込み。値はチャンネルごとの RMS 振幅（0..1）と帯域・波形。
// VU への換算は参照レベルが要るので部品側（refDb）で行う。
//
// Rust からイベントで送りつけず、画面の描画1回ごとに最新の1フレームを取りに行く。
// Tauri のイベントは webview で JavaScript を評価して届けるので、60Hz で送り続けると
// ページのメモリが増え続け、約7時間で OOM で落ちた（tauri-apps/tauri#12724）。
// 取りに行く形なら、ページが忙しい・隠れている・落ちているときにデータがたまらない。

// 参照が 0 になってから実際に手放すまでの猶予。構造の作り直しを跨ぐ長さが要る。
const IDLE_RELEASE_MS = 1500;

interface Level {
  l: number; r: number;        // チャンネルごとの RMS 振幅 0..1
  bands: number[];             // 64帯の強さ 0..255（-70..0 dB）
  wl: number[]; wr: number[];  // 波形 -127..127
}
interface Status { running: boolean; device: string; rate: number; channels: number; error: string }

class AudioHub {
  /** 最新の RMS。針は毎フレームここを読む。$state だと 60Hz で再描画が走るので素の値にする。 */
  level: Level = { l: 0, r: 0, bands: [], wl: [], wr: [] };
  status = $state<Status>({ running: false, device: "", rate: 0, channels: 0, error: "" });
  /** この部品が何個使っているか。0 になったら取り込みを止める。 */
  private users = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;

  /** DAW が排他モードで開く前に手で止めておくための停止。部品を消さずに device を手放す。 */
  paused = $state(false);

  private polling = false;

  private async ensure(): Promise<void> {
    if (this.started || this.paused) return;
    this.started = true;
    try {
      this.status = await invoke<Status>("audio_start");
      this.poll();
    } catch (e) {
      this.started = false;
      this.status = { ...this.status, running: false, error: String(e) };
    }
  }

  /**
   * 描画1回ごとに最新フレームを1つ取る。前の取得が終わるまで次は出さない（重ならない）。
   * requestAnimationFrame なので、ウィンドウが隠れているときは自然に止まる。
   */
  private poll(): void {
    if (this.polling) return;
    this.polling = true;
    const tick = async () => {
      if (!this.started) { this.polling = false; return; }
      try {
        const f = await invoke<Level | null>("audio_frame");
        if (f) this.level = f;
      } catch { /* 1回の失敗は次のフレームで取り直す */ }
      requestAnimationFrame(() => { void tick(); });
    };
    void tick();
  }

  /**
   * 音声ビジュアライザ部品が1つ現れた。戻り値を呼ぶと解放。
   *
   * キャンバスは構造が変わるたび全部を作り直すので、参照は毎回 0 を通る。
   * そこで即座に止めるとスライダーを動かすたびにデバイスを掴み直すことになるので、
   * 少し待ってから、まだ 0 のときだけ止める。
   */
  acquire(): () => void {
    this.users++;
    if (this.idleTimer !== null) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    void this.ensure();
    let freed = false;
    return () => {
      if (freed) return;
      freed = true;
      if (--this.users > 0) return;
      this.users = 0;
      if (this.idleTimer !== null) clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => {
        this.idleTimer = null;
        if (this.users > 0) return;   // 作り直しの途中なら掴んだままにする
        this.started = false;
        this.level = { l: 0, r: 0, bands: [], wl: [], wr: [] };
        void invoke("audio_stop").catch(() => { /* 停止の失敗は無視 */ });
        this.status = { ...this.status, running: false };
      }, IDLE_RELEASE_MS);
    };
  }

  async refreshStatus(): Promise<void> {
    try { this.status = await invoke<Status>("audio_status"); } catch { /* 無視 */ }
  }

  /** 取り込みを止める／再開する。止めている間はデバイスを掴まない。 */
  async setPaused(p: boolean): Promise<void> {
    this.paused = p;
    if (p) {
      this.started = false;
      this.level = { l: 0, r: 0, bands: [], wl: [], wr: [] };
      try { await invoke("audio_stop"); } catch { /* 無視 */ }
      this.status = { ...this.status, running: false };
    } else if (this.users > 0) {
      await this.ensure();
    }
  }
}

export const audio = new AudioHub();
