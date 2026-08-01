import { invoke } from "@tauri-apps/api/core";

// Claude Code / Codex の設定ファイルへフックを書き込む機能の状態。
// 対象ファイルのパスも持たせて、UI で「どこを書き換えるか」を提示できるようにする。
export interface AiHookStatus {
  claude_enabled: boolean;
  codex_enabled: boolean;
  claude_config: string;
  codex_config: string;
  hook_exe: string;
  hook_exe_ready: boolean;
  codex_needs_trust: boolean; // Codexはフック変更後に承認が要る
}

const EMPTY: AiHookStatus = {
  claude_enabled: false,
  codex_enabled: false,
  claude_config: "",
  codex_config: "",
  hook_exe: "",
  hook_exe_ready: false,
  codex_needs_trust: false,
};

export const aiHookStore = $state<{
  status: AiHookStatus;
  ready: boolean;
  busy: boolean;
  error: string;
  notice: string; // 有効化後にユーザーがやることの案内（エラーではない）
}>({
  status: EMPTY,
  ready: false,
  busy: false,
  error: "",
  notice: "",
});

export async function loadAiHooks(): Promise<void> {
  try {
    aiHookStore.status = await invoke<AiHookStatus>("ai_hooks_status");
  } catch {
    // 非Tauri実行時などは既定のまま
  }
  aiHookStore.ready = true;
}

// 有効化/無効化。失敗理由はユーザーに見せる（設定ファイルの書き換えなので黙って失敗させない）。
export async function setAiHooks(on: boolean): Promise<void> {
  aiHookStore.busy = true;
  aiHookStore.error = "";
  aiHookStore.notice = "";
  try {
    aiHookStore.status = await invoke<AiHookStatus>("set_ai_hooks", { enable: on });
    if (on) {
      // Codex は変更後のフックを承認するまで実行しない。気付けないと「動かない」で終わるので出す。
      aiHookStore.notice = aiHookStore.status.codex_needs_trust
        ? "Codex の TUI で /hooks を打ってフックを承認してください。Claude Code は再起動で反映されます。"
        : "Claude Code を再起動すると反映されます。";
    }
  } catch (e) {
    aiHookStore.error = String(e);
    await loadAiHooks(); // 実状態へ戻す
  } finally {
    aiHookStore.busy = false;
  }
}

// 片方だけ入っている状態もあるので、UIの表示用にまとめる。
export function aiHookLabel(s: AiHookStatus): string {
  if (s.claude_enabled && s.codex_enabled) return "Claude / Codex 有効";
  if (s.claude_enabled) return "Claude のみ有効";
  if (s.codex_enabled) return "Codex のみ有効";
  return "無効";
}
