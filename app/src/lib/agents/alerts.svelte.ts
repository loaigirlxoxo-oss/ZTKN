import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

// 承認待ちのエージェントセッション（フックexeが ~/.claude/ztkn-state/ に書き、Rustが集約配信）。
export interface AgentAlert {
  session_id: string;
  folder: string; // 作業フォルダ名（どのインスタンスか識別）
  cwd: string;
  since: number; // 状態になった unix 秒
  provider: string; // "claude" | "codex"
  status: string; // "running"（実行中） | "waiting"（承認待ち）
}

class AgentAlertStore {
  list = $state<AgentAlert[]>([]);
  private started = false;

  private ingest(raw: string): void {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) this.list = arr as AgentAlert[];
    } catch {
      /* 壊れていたら無視 */
    }
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await listen<string>("agent-alerts", (e) => this.ingest(e.payload));
    // 起動直後の取り逃し対策に一度即取得
    try {
      this.ingest(await invoke<string>("get_agent_alerts"));
    } catch {
      /* 非Tauri実行時等は無視 */
    }
  }
}

export const agentAlerts = new AgentAlertStore();
