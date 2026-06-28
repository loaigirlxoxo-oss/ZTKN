import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";

// OSログイン時の自動起動の状態を保持・操作する。
export const autostartStore = $state<{ enabled: boolean; ready: boolean }>({ enabled: false, ready: false });

export async function loadAutostart(): Promise<void> {
  try {
    autostartStore.enabled = await isEnabled();
  } catch {
    // 非Tauri実行時などは既定(false)のまま
  }
  autostartStore.ready = true;
}

export async function toggleAutostart(on: boolean): Promise<void> {
  try {
    if (on) await enable();
    else await disable();
  } catch {
    // 失敗は握りつぶさず、下で実状態に同期して表示を戻す
  }
  try {
    autostartStore.enabled = await isEnabled();
  } catch {
    autostartStore.enabled = on;
  }
}
