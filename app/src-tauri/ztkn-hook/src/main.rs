// ZTKN 用の Claude Code / Codex フックヘルパー（超軽量・高速起動）。
// フックから呼ばれ、標準入力のフックJSONを読み、
// ~/.claude/ztkn-state/<session_id>.json を作成/削除して「実行中/承認待ち」を通知する。
// 使い方: ztkn-hook <running|wait|clear> [provider]   （フックJSONはstdinで渡される）
// PostToolUse で毎回走るため、PowerShellでなくネイティブexeで遅延を避ける。常に正常終了しClaudeを止めない。
//
// GUIサブシステム: コンソールを一切持たないので、Codex等がどう起動しても黒窓が出ない。
// stdin はパイプ経由で読めるため、ウィンドウ無しでもフックJSONは受け取れる。
// このクレートは tauri-build を通さない独立クレートなので requireAdministrator が付かず、
// 非昇格プロセス(Codex/Claude)から起動されても UAC が出ない。
#![windows_subsystem = "windows"]
use std::io::Read;

fn main() {
    let action = std::env::args().nth(1).unwrap_or_default();
    // 第2引数でプロバイダを指定（既定 claude）。Claude Code フックは "claude"、Codex用は "codex"。
    let provider = std::env::args().nth(2).unwrap_or_else(|| "claude".to_string());
    let mut input = String::new();
    if std::io::stdin().read_to_string(&mut input).is_err() {
        return;
    }
    let v: serde_json::Value = match serde_json::from_str(&input) {
        Ok(v) => v,
        Err(_) => return,
    };
    let sid = v["session_id"].as_str().unwrap_or("");
    if sid.is_empty() {
        return;
    }
    // session_id をファイル名に使うのでサニタイズ
    let safe: String = sid
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-') { c } else { '_' })
        .collect();
    let dir = match dirs::home_dir() {
        Some(h) => h.join(".claude").join("ztkn-state"),
        None => return,
    };
    let file = dir.join(format!("{safe}.json"));
    // running/wait は状態を書き、idle(その他)はファイル削除（＝非アクティブ）。
    // ファイル存在＝アクティブ、status で 実行中/承認待ち を区別する。
    let status = match action.as_str() {
        "running" => "running",
        "wait" | "waiting" => "waiting",
        _ => {
            let _ = std::fs::remove_file(&file); // idle/clear/その他
            return;
        }
    };
    let _ = std::fs::create_dir_all(&dir);
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let out = serde_json::json!({
        "session_id": sid,
        "cwd": v["cwd"].as_str().unwrap_or(""),
        "ts": ts,
        "provider": provider,
        "status": status,
    });
    let _ = std::fs::write(&file, out.to_string());
}
