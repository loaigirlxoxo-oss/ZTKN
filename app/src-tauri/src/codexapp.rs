// Codex アプリ（デスクトップ版）の「実行中」を検出する。
//
// アプリは CLI と違い app-server モードで動き、config.toml のフックを実行しない
// （サンドボックスログにフック実行の記録が一切残らないことを実測で確認）。
// app-server のプロトコルには承認要求が定義されているが、アプリと app-server は
// stdio で直結しており外部から接続する制御ソケットも存在しないため、通信を観測できない。
//
// 代わりに、アプリがディスクへ書くセッション記録を読む:
//   ~/.codex/sessions/YYYY/MM/DD/rollout-<時刻>-<session_id>.jsonl
// この JSONL に task_started / task_complete が記録されるので、
// 開始が完了を上回っていればそのセッションは実行中とみなす。
//
// 制約: 承認待ちは検出できない。承認要求はディスクに残らない。

use std::path::{Path, PathBuf};

// この時間より古い記録は見ない。走査コストを抑えつつ、放置セッションを除外する。
const RECENT_SECS: u64 = 3600;

#[derive(Debug, Clone, PartialEq)]
pub struct AppThread {
    pub session_id: String,
    pub cwd: String,
    pub since: u64, // 最後に task_started が記録された時刻（unix秒）
}

fn sessions_dir() -> Option<PathBuf> {
    if let Ok(h) = std::env::var("CODEX_HOME") {
        let h = h.trim();
        if !h.is_empty() {
            return Some(PathBuf::from(h).join("sessions"));
        }
    }
    Some(dirs::home_dir()?.join(".codex").join("sessions"))
}

// sessions/年/月/日/ の3階層を辿って rollout-*.jsonl を集める。
// 全部を舐めると数百件になるので、更新が新しいものだけ返す。
fn recent_rollouts(dir: &Path, now: u64) -> Vec<PathBuf> {
    let mut out = vec![];
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            let Ok(md) = e.metadata() else { continue };
            if md.is_dir() {
                stack.push(p);
                continue;
            }
            if !p.file_name().and_then(|s| s.to_str()).map(|n| n.starts_with("rollout-") && n.ends_with(".jsonl")).unwrap_or(false) {
                continue;
            }
            let age = md
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| now.saturating_sub(d.as_secs()))
                .unwrap_or(u64::MAX);
            if age <= RECENT_SECS {
                out.push(p);
            }
        }
    }
    out
}

// ISO8601("2026-08-02T03:15:29.123Z") を unix秒へ。解釈不能は 0。
fn iso_to_secs(s: &str) -> u64 {
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.timestamp().max(0) as u64)
        .unwrap_or(0)
}

// 1つの記録ファイルを読み、実行中ならセッション情報を返す。
// 判定: task_started の数 > task_complete の数。
pub fn parse_rollout(text: &str) -> Option<AppThread> {
    let mut session_id = String::new();
    let mut cwd = String::new();
    let mut started = 0usize;
    let mut completed = 0usize;
    let mut last_start = 0u64;

    for line in text.lines() {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        match v["type"].as_str() {
            Some("session_meta") => {
                let p = &v["payload"];
                if session_id.is_empty() {
                    session_id = p["session_id"].as_str().or_else(|| p["id"].as_str()).unwrap_or("").to_string();
                }
                if cwd.is_empty() {
                    cwd = p["cwd"].as_str().unwrap_or("").to_string();
                }
            }
            Some("event_msg") => match v["payload"]["type"].as_str() {
                Some("task_started") => {
                    started += 1;
                    last_start = v["timestamp"].as_str().map(iso_to_secs).unwrap_or(last_start);
                }
                Some("task_complete") => completed += 1,
                _ => {}
            },
            _ => {}
        }
    }
    if started > completed && !session_id.is_empty() {
        Some(AppThread { session_id, cwd, since: last_start })
    } else {
        None
    }
}

// 実行中の Codex アプリセッション一覧。
pub fn running_threads() -> Vec<AppThread> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let Some(dir) = sessions_dir() else { return vec![] };
    if !dir.is_dir() {
        return vec![];
    }
    let mut out = vec![];
    for p in recent_rollouts(&dir, now) {
        let Ok(txt) = std::fs::read_to_string(&p) else { continue };
        if let Some(t) = parse_rollout(&txt) {
            out.push(t);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const META: &str = r#"{"type":"session_meta","payload":{"session_id":"abc-123","cwd":"D:\\VSCode\\PC Status"}}"#;
    fn ev(t: &str, ts: &str) -> String {
        format!(r#"{{"type":"event_msg","timestamp":"{ts}","payload":{{"type":"{t}"}}}}"#)
    }

    #[test]
    fn detects_running_when_start_exceeds_complete() {
        let txt = format!("{META}\n{}\n", ev("task_started", "2026-08-02T03:15:29.000Z"));
        let t = parse_rollout(&txt).expect("実行中と判定されるはず");
        assert_eq!(t.session_id, "abc-123");
        assert_eq!(t.cwd, r"D:\VSCode\PC Status");
        assert!(t.since > 0, "開始時刻が取れていない");
    }

    #[test]
    fn not_running_when_balanced() {
        let txt = format!(
            "{META}\n{}\n{}\n",
            ev("task_started", "2026-08-02T03:15:29.000Z"),
            ev("task_complete", "2026-08-02T03:15:40.000Z")
        );
        assert!(parse_rollout(&txt).is_none(), "完了しているのに実行中と判定された");
    }

    // 複数ターンを繰り返した後で最後だけ実行中、というのが実際の形
    #[test]
    fn detects_running_after_several_completed_turns() {
        let mut txt = String::from(META);
        for _ in 0..3 {
            txt.push('\n');
            txt.push_str(&ev("task_started", "2026-08-02T03:00:00.000Z"));
            txt.push('\n');
            txt.push_str(&ev("task_complete", "2026-08-02T03:00:10.000Z"));
        }
        txt.push('\n');
        txt.push_str(&ev("task_started", "2026-08-02T03:20:00.000Z"));
        let t = parse_rollout(&txt).expect("最後のターンが実行中");
        // since は最後の task_started
        assert_eq!(t.since, iso_to_secs("2026-08-02T03:20:00.000Z"));
    }

    #[test]
    fn ignores_broken_lines_and_missing_meta() {
        let txt = format!("これはJSONではない\n{}\n", ev("task_started", "2026-08-02T03:15:29.000Z"));
        // session_meta が無ければ識別できないので拾わない
        assert!(parse_rollout(&txt).is_none());
    }

    #[test]
    fn empty_input_is_safe() {
        assert!(parse_rollout("").is_none());
    }
}
