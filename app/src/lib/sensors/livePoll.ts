import { invoke } from "@tauri-apps/api/core";

// センサー・AI使用量・承認待ちを、Rust の最新値置き場（live.rs）から取りに行く。
//
// 以前は Tauri のイベントで受けていたが、イベントは webview で JavaScript を評価して届けるため
// WebView2 の renderer 内に溜まり（tauri-apps/tauri#12724）、センサー約33KBを毎秒2回受け続けると
// ネイティブ側のメモリが倍々の段で増え、7〜9時間で OOM で落ちた。
// ここでは前回から変わったものだけを受け取る。

interface LiveItem { key: string; seq: number; value: string }
type Handler = (value: string) => void;

const POLL_MS = 500; // サイドカーの送出間隔と同じ
const handlers = new Map<string, Handler[]>();
const known: Record<string, number> = {};
let timer: ReturnType<typeof setInterval> | null = null;
let inflight = false;

/** key の値が変わるたびに呼ばれる。初回の登録でポーリングが始まる。 */
export function onLive(key: string, fn: Handler): void {
  const list = handlers.get(key) ?? [];
  list.push(fn);
  handlers.set(key, list);
  if (!timer) {
    timer = setInterval(() => { void tick(); }, POLL_MS);
    void tick();
  }
}

async function tick(): Promise<void> {
  if (inflight) return; // 前の取得が終わるまで次を出さない（重ならない）
  inflight = true;
  try {
    const items = await invoke<LiveItem[]>("get_live", { known });
    for (const it of items) {
      known[it.key] = it.seq;
      for (const fn of handlers.get(it.key) ?? []) {
        try { fn(it.value); } catch (e) { console.error(`[live] ${it.key} の処理に失敗`, e); }
      }
    }
  } catch {
    /* 非Tauri実行時や一時的な失敗は次の周期で取り直す */
  } finally {
    inflight = false;
  }
}
