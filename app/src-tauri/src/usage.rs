// Claude のプラン使用量(残量%・リセット時刻)を取得するコレクタ。
// 参照実装 bozdemir/claude-usage-widget のプロトコルを Rust でネイティブ再現する。
// データ源は Claude UI/CLI 自身が使う /api/oauth/usage（＝推測ではなく実値）。Python 依存なし。
// 非公開エンドポイントなのでスキーマ変化に強いよう防御的にパースし、失敗はソフトに扱う。

use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};

// フロントへ渡す Claude 使用量。% は 0..100、reset は unix epoch ミリ秒（0=不明）。
#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct ClaudeUsage {
    pub session_pct: f64, // 5時間枠の使用率
    pub session_reset: i64,
    pub weekly_pct: f64, // 7日枠の使用率
    pub weekly_reset: i64,
    pub scoped_pct: f64, // モデル別週枠(Opus/Fable等)。無ければ0
    pub scoped_reset: i64,
    pub scoped_label: String,
    pub overage_enabled: bool, // 従量オーバー可否
}

const CLAUDE_USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const OAUTH_BETA: &str = "oauth-2025-04-20";

// 0..100 に丸めた百分率。数値でなければ 0。
fn pct(v: &Value) -> f64 {
    v.as_f64().map(|f| f.clamp(0.0, 100.0)).unwrap_or(0.0)
}

// RFC3339("...+00:00" / "...Z") を epoch ミリ秒へ。解釈不能は 0。
fn iso_to_epoch_ms(v: &Value) -> i64 {
    v.as_str()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.timestamp_millis())
        .unwrap_or(0)
}

// /api/oauth/usage のレスポンス本文を ClaudeUsage へ。欠損は 0/空にフォールバック（パニックさせない）。
pub fn parse_claude_usage(body: &str) -> Result<ClaudeUsage, String> {
    let v: Value = serde_json::from_str(body).map_err(|e| format!("bad json: {e}"))?;
    if !v.is_object() {
        return Err("unexpected /api/oauth/usage payload".into());
    }
    let five = &v["five_hour"];
    let seven = &v["seven_day"];

    // モデル別週枠は limits[] の kind=="weekly_scoped"。使用率が最大の1件を採る
    // （＝ユーザーが最も枠に近いモデル。将来モデルが増えてもコード変更不要）。
    let mut scoped_pct = 0.0;
    let mut scoped_reset = 0;
    let mut scoped_label = String::new();
    if let Some(limits) = v["limits"].as_array() {
        let mut best = -1.0;
        for lim in limits {
            if lim["kind"].as_str() != Some("weekly_scoped") {
                continue;
            }
            let label = lim["scope"]["model"]["display_name"]
                .as_str()
                .unwrap_or("")
                .trim()
                .to_string();
            if label.is_empty() {
                continue;
            }
            let p = pct(&lim["percent"]);
            if p > best {
                best = p;
                scoped_pct = p;
                scoped_reset = iso_to_epoch_ms(&lim["resets_at"]);
                scoped_label = label;
            }
        }
    }

    Ok(ClaudeUsage {
        session_pct: pct(&five["utilization"]),
        session_reset: iso_to_epoch_ms(&five["resets_at"]),
        weekly_pct: pct(&seven["utilization"]),
        weekly_reset: iso_to_epoch_ms(&seven["resets_at"]),
        scoped_pct,
        scoped_reset,
        scoped_label,
        overage_enabled: v["extra_usage"]["is_enabled"].as_bool().unwrap_or(false),
    })
}

// 使用量を既存 sensor パイプライン互換の {source, sensors:[...]} JSON にする。
// フロントは既存のカタログ/ピッカー/valueOf/ゲージ描画をそのまま使える（id は hw|name|type）。
// 値は使用率(used%) 0..100。リセット時刻は段階3(カウントダウン)で別途扱う。
// 使用率(0..100, unit=%) と リセット時刻(epoch ms, type=Reset) の2系統を sensor エントリ配列にする。
// リセットはフロントで %t トークン＝残り時間カウントダウンとして描画する。
fn claude_sensors(u: &ClaudeUsage) -> Vec<Value> {
    let pct = |name: &str, value: f64| {
        json!({ "id": format!("Claude|{name}|Usage"), "name": name, "hw": "Claude", "type": "Usage", "unit": "%", "value": value })
    };
    let reset = |name: &str, value: i64| {
        json!({ "id": format!("Claude|{name}|Reset"), "name": name, "hw": "Claude", "type": "Reset", "unit": "", "value": value })
    };
    let mut sensors = vec![
        pct("5h 使用率", u.session_pct),
        reset("5h リセット", u.session_reset),
        pct("7d 使用率", u.weekly_pct),
        reset("7d リセット", u.weekly_reset),
    ];
    if !u.scoped_label.is_empty() {
        sensors.push(pct(&format!("{} 週枠", u.scoped_label), u.scoped_pct));
        sensors.push(reset(&format!("{} 週枠リセット", u.scoped_label), u.scoped_reset));
    }
    sensors
}

// Claude+Codex を1つの usage イベントにまとめる。値マップを潰し合わないよう常に全部入りで出す
// （取得失敗した提供元は None＝その分は前回値がフロントに残る形にはならないが、片方だけ出せる）。
pub fn usage_event_json(claude: Option<&ClaudeUsage>, codex: Option<&CodexUsage>) -> String {
    let mut sensors: Vec<Value> = vec![];
    if let Some(c) = claude {
        sensors.extend(claude_sensors(c));
    }
    if let Some(c) = codex {
        sensors.extend(codex_sensors(c));
    }
    json!({ "source": "usage", "sensors": sensors }).to_string()
}

// 起動時シード等で Claude 単体を出す薄いラッパ。
pub fn claude_usage_event_json(u: &ClaudeUsage) -> String {
    usage_event_json(Some(u), None)
}

// OAuth アクセストークンを Claude Code と同じ探索順で得る。
// 環境変数 CLAUDE_CODE_OAUTH_TOKEN → ~/.claude/.credentials.json の claudeAiOauth.accessToken。
fn load_claude_token() -> Option<String> {
    if let Ok(t) = std::env::var("CLAUDE_CODE_OAUTH_TOKEN") {
        let t = t.trim().to_string();
        if !t.is_empty() {
            return Some(t);
        }
    }
    let path = dirs::home_dir()?.join(".claude").join(".credentials.json");
    let blob = std::fs::read_to_string(path).ok()?;
    let v: Value = serde_json::from_str(&blob).ok()?;
    let tok = v["claudeAiOauth"]["accessToken"].as_str()?.trim().to_string();
    if tok.is_empty() {
        None
    } else {
        Some(tok)
    }
}

// 実 API を叩いて Claude 使用量を取得。外部通信なのでタイムアウトを付ける。
pub fn fetch_claude_usage() -> Result<ClaudeUsage, String> {
    let token =
        load_claude_token().ok_or_else(|| "no Claude credentials (run `claude` to log in)".to_string())?;
    let tls = native_tls::TlsConnector::new().map_err(|e| format!("tls init: {e}"))?;
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(5))
        .timeout_read(Duration::from_secs(10))
        .tls_connector(std::sync::Arc::new(tls))
        .build();
    let resp = agent
        .get(CLAUDE_USAGE_URL)
        .set("Authorization", &format!("Bearer {token}"))
        .set("anthropic-beta", OAUTH_BETA)
        .set("User-Agent", "ZTKN")
        .call();
    let body = match resp {
        Ok(r) => r.into_string().map_err(|e| format!("read body: {e}"))?,
        Err(ureq::Error::Status(code, _)) => {
            return Err(match code {
                401 => "unauthorized (credentials expired? re-login)".into(),
                429 => "rate limited".into(),
                _ => format!("http {code}"),
            })
        }
        Err(e) => return Err(format!("request failed: {e}")),
    };
    parse_claude_usage(&body)
}

// ---- Codex（OpenAI）の使用量。ローカル codex CLI の app-server に stdio JSON-RPC で問い合わせる ----

// フロントへ渡す Codex 使用量。% は 0..100、reset は epoch ミリ秒。
// プランにより 5h枠だけ／7d枠だけ／両方 とまちまちなので、存在する枠だけ has_* で持つ。
#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct CodexUsage {
    pub h5_pct: f64,
    pub h5_reset: i64,
    pub has_5h: bool,
    pub d7_pct: f64,
    pub d7_reset: i64,
    pub has_7d: bool,
}

fn codex_sensors(u: &CodexUsage) -> Vec<Value> {
    let pct = |name: &str, value: f64| {
        json!({ "id": format!("Codex|{name}|Usage"), "name": name, "hw": "Codex", "type": "Usage", "unit": "%", "value": value })
    };
    let reset = |name: &str, value: i64| {
        json!({ "id": format!("Codex|{name}|Reset"), "name": name, "hw": "Codex", "type": "Reset", "unit": "", "value": value })
    };
    let mut s = vec![];
    if u.has_5h {
        s.push(pct("5h 使用率", u.h5_pct));
        s.push(reset("5h リセット", u.h5_reset));
    }
    if u.has_7d {
        s.push(pct("7d 使用率", u.d7_pct));
        s.push(reset("7d リセット", u.d7_reset));
    }
    s
}

// account/rateLimits/read の result を CodexUsage へ（防御的）。
// primary/secondary を位置ではなく windowDurationMins で 5h枠(≤720分)/7d枠 に振り分ける
// （実機 plus は primary=10080分=7d の1枠のみ等、プラン差があるため）。resetsAt は epoch秒→ms。
pub fn parse_codex_rate_limits(result: &Value) -> Option<CodexUsage> {
    let limits = result.get("rateLimits")?;
    let mut u = CodexUsage::default();
    let mut any = false;
    for key in ["primary", "secondary"] {
        let block = &limits[key];
        let Some(pct) = block.get("usedPercent").and_then(|v| v.as_f64()) else {
            continue;
        };
        let pct = pct.clamp(0.0, 100.0);
        let reset = block.get("resetsAt").and_then(|r| r.as_i64()).unwrap_or(0);
        let reset_ms = if reset > 0 && reset < 1_000_000_000_000 { reset * 1000 } else { reset };
        let mins = block.get("windowDurationMins").and_then(|v| v.as_i64()).unwrap_or(0);
        any = true;
        if mins > 0 && mins <= 720 {
            u.h5_pct = pct;
            u.h5_reset = reset_ms;
            u.has_5h = true;
        } else {
            u.d7_pct = pct;
            u.d7_reset = reset_ms;
            u.has_7d = true;
        }
    }
    if any {
        Some(u)
    } else {
        None
    }
}

// PATH から codex を解決。実行可能拡張子(.exe/.cmd/.bat)を優先（where は拡張子なしのshimも返す）。
fn find_codex() -> Option<String> {
    if let Ok(p) = std::env::var("CODEX_BIN") {
        let p = p.trim().to_string();
        if !p.is_empty() {
            return Some(p);
        }
    }
    let mut cmd = Command::new("where");
    cmd.arg("codex");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut lines: Vec<String> = text.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect();
    lines.sort_by_key(|l| {
        let low = l.to_ascii_lowercase();
        if low.ends_with(".exe") { 0 } else if low.ends_with(".cmd") || low.ends_with(".bat") { 1 } else { 2 }
    });
    lines.into_iter().next()
}

fn codex_command(bin: &str) -> Command {
    let low = bin.to_ascii_lowercase();
    // .cmd/.bat は cmd.exe 経由でないと起動できない
    let mut c = if low.ends_with(".cmd") || low.ends_with(".bat") {
        let mut c = Command::new("cmd");
        c.args(["/C", bin, "app-server"]);
        c
    } else {
        let mut c = Command::new(bin);
        c.arg("app-server");
        c
    };
    c.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x08000000);
    }
    c
}

#[cfg(windows)]
fn kill_tree(pid: u32) {
    // cmd.exe 経由起動だと子(node)が残るため、ツリーごと確実に終了させる
    let mut cmd = Command::new("taskkill");
    cmd.args(["/PID", &pid.to_string(), "/T", "/F"]);
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x08000000);
    let _ = cmd.output();
}

// initialize -> initialized -> account/rateLimits/read を1往復する。
fn codex_rpc(stdin: &mut std::process::ChildStdin, stdout: std::process::ChildStdout) -> Result<CodexUsage, String> {
    fn send(w: &mut std::process::ChildStdin, v: &Value) -> Result<(), String> {
        let mut line = v.to_string();
        line.push('\n');
        w.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
        w.flush().map_err(|e| e.to_string())
    }
    send(stdin, &json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"ZTKN","title":"ZTKN","version":"0"}}}))?;
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    loop {
        line.clear();
        if reader.read_line(&mut line).map_err(|e| e.to_string())? == 0 {
            return Err("codex app-server closed before init".into());
        }
        if let Ok(msg) = serde_json::from_str::<Value>(line.trim()) {
            if msg.get("id").and_then(|i| i.as_i64()) == Some(1) {
                break;
            }
        }
    }
    send(stdin, &json!({"jsonrpc":"2.0","method":"initialized"}))?;
    thread::sleep(Duration::from_millis(600)); // ハンドシェイク直後は一拍置かないと取りこぼす
    send(stdin, &json!({"jsonrpc":"2.0","id":2,"method":"account/rateLimits/read","params":{}}))?;
    loop {
        line.clear();
        if reader.read_line(&mut line).map_err(|e| e.to_string())? == 0 {
            return Err("codex app-server closed before rateLimits".into());
        }
        if let Ok(msg) = serde_json::from_str::<Value>(line.trim()) {
            if msg.get("id").and_then(|i| i.as_i64()) == Some(2) {
                let result = msg.get("result").ok_or_else(|| format!("codex rateLimits: no result in {msg}"))?;
                return parse_codex_rate_limits(result).ok_or_else(|| format!("codex rateLimits: no usable windows in {result}"));
            }
        }
    }
}

// codex app-server を起動して使用量を取る。spawnが重く固まり得るのでタイムアウト＋ツリー終了。
pub fn fetch_codex_usage() -> Result<CodexUsage, String> {
    let bin = find_codex().ok_or("codex not found on PATH")?;
    let mut child = codex_command(&bin).spawn().map_err(|e| format!("spawn codex: {e}"))?;
    let pid = child.id();
    let mut stdin = child.stdin.take().ok_or("codex: no stdin")?;
    let stdout = child.stdout.take().ok_or("codex: no stdout")?;
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let _ = tx.send(codex_rpc(&mut stdin, stdout));
    });
    let outcome = rx.recv_timeout(Duration::from_secs(30)); // app-serverのコールドスタート耐性
    #[cfg(windows)]
    kill_tree(pid);
    #[cfg(not(windows))]
    {
        let _ = child.kill();
    }
    let _ = child.wait();
    match outcome {
        Ok(inner) => inner,
        Err(_) => Err("codex app-server timeout".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_windows_and_picks_highest_scoped() {
        let body = r#"{
            "five_hour": { "utilization": 42.5, "resets_at": "2026-07-20T15:00:00+00:00" },
            "seven_day": { "utilization": 12, "resets_at": "2026-07-25T00:00:00Z" },
            "extra_usage": { "is_enabled": true },
            "limits": [
                { "kind": "weekly_scoped", "percent": 30, "resets_at": "2026-07-25T00:00:00Z",
                  "scope": { "model": { "display_name": "Opus" } } },
                { "kind": "weekly_scoped", "percent": 70, "resets_at": "2026-07-25T00:00:00Z",
                  "scope": { "model": { "display_name": "Fable" } } }
            ]
        }"#;
        let u = parse_claude_usage(body).unwrap();
        assert_eq!(u.session_pct, 42.5);
        assert_eq!(u.weekly_pct, 12.0);
        assert!(u.overage_enabled);
        // 使用率最大(Fable 70)が採用される
        assert_eq!(u.scoped_pct, 70.0);
        assert_eq!(u.scoped_label, "Fable");
        assert!(u.session_reset > 0);
        assert!(u.weekly_reset > 0);
    }

    #[test]
    fn missing_fields_default_to_zero_not_panic() {
        let u = parse_claude_usage("{}").unwrap();
        assert_eq!(u.session_pct, 0.0);
        assert_eq!(u.session_reset, 0);
        assert_eq!(u.scoped_label, "");
        assert!(!u.overage_enabled);
    }

    #[test]
    fn non_object_payload_is_error() {
        assert!(parse_claude_usage("[]").is_err());
        assert!(parse_claude_usage("not json").is_err());
    }

    #[test]
    fn event_json_has_expected_sensor_entries() {
        let u = ClaudeUsage {
            session_pct: 46.0,
            weekly_pct: 66.0,
            scoped_pct: 6.0,
            scoped_label: "Fable".into(),
            ..Default::default()
        };
        let u = ClaudeUsage { session_reset: 1_700_000_000_000, ..u };
        let v: Value = serde_json::from_str(&claude_usage_event_json(&u)).unwrap();
        assert_eq!(v["source"], "usage");
        let sensors = v["sensors"].as_array().unwrap();
        assert_eq!(sensors.len(), 6); // 5h%, 5hリセット, 7d%, 7dリセット, scoped%, scopedリセット
        assert_eq!(sensors[0]["id"], "Claude|5h 使用率|Usage");
        assert_eq!(sensors[0]["hw"], "Claude");
        assert_eq!(sensors[0]["unit"], "%");
        assert_eq!(sensors[0]["value"], 46.0);
        // リセットは type=Reset・エポックmsをそのまま値に
        assert_eq!(sensors[1]["type"], "Reset");
        assert_eq!(sensors[1]["value"], 1_700_000_000_000_i64);
        assert_eq!(sensors[2]["value"], 66.0); // 7d%
        assert_eq!(sensors[4]["name"], "Fable 週枠");
        assert_eq!(sensors[4]["value"], 6.0);
        assert_eq!(sensors[5]["name"], "Fable 週枠リセット");
    }

    #[test]
    fn event_json_omits_scoped_when_absent() {
        let u = ClaudeUsage { scoped_label: String::new(), ..Default::default() };
        let v: Value = serde_json::from_str(&claude_usage_event_json(&u)).unwrap();
        assert_eq!(v["sensors"].as_array().unwrap().len(), 4); // scoped無しなら 5h%/5hリセット/7d%/7dリセット
    }

    #[test]
    fn parses_codex_windows_by_duration() {
        // 5h枠(300分)と7d枠(10080分)が両方ある場合、期間で振り分ける
        let result = json!({ "rateLimits": {
            "primary": { "usedPercent": 23.0, "resetsAt": 1_700_000_000_i64, "windowDurationMins": 300 },
            "secondary": { "usedPercent": 41.0, "resetsAt": 1_700_500_000_i64, "windowDurationMins": 10080 }
        }});
        let u = parse_codex_rate_limits(&result).unwrap();
        assert!(u.has_5h && u.has_7d);
        assert_eq!(u.h5_pct, 23.0);
        assert_eq!(u.h5_reset, 1_700_000_000_000); // 秒→ms
        assert_eq!(u.d7_pct, 41.0);
        assert_eq!(u.d7_reset, 1_700_500_000_000);
    }

    #[test]
    fn codex_single_7d_window_only() {
        // 実機 plus: primary=10080分(7d) の1枠のみ、secondary=null
        let result = json!({ "rateLimits": {
            "primary": { "usedPercent": 1.0, "resetsAt": 1_784_994_943_i64, "windowDurationMins": 10080 },
            "secondary": null
        }});
        let u = parse_codex_rate_limits(&result).unwrap();
        assert!(!u.has_5h);
        assert!(u.has_7d);
        assert_eq!(u.d7_pct, 1.0);
        // codex_sensors は 7d の2件だけ（5hは出さない）
        let s = codex_sensors(&u);
        assert_eq!(s.len(), 2);
        assert_eq!(s[0]["id"], "Codex|7d 使用率|Usage");
        assert_eq!(s[1]["id"], "Codex|7d リセット|Reset");
    }

    #[test]
    fn codex_none_when_empty() {
        assert!(parse_codex_rate_limits(&json!({})).is_none());
        assert!(parse_codex_rate_limits(&json!({ "rateLimits": {} })).is_none());
    }

    // codex app-server を実起動する実測テスト（このPCに codex 導入済み）。
    // 実行: cargo test real_codex_usage -- --ignored --nocapture
    #[test]
    #[ignore]
    fn real_codex_usage() {
        match fetch_codex_usage() {
            Ok(u) => {
                println!(
                    "REAL Codex usage: has5h={} 5h={:.1}%(reset_ms={}) / has7d={} 7d={:.1}%(reset_ms={})",
                    u.has_5h, u.h5_pct, u.h5_reset, u.has_7d, u.d7_pct, u.d7_reset
                );
                println!("EVENT JSON: {}", usage_event_json(None, Some(&u)));
                assert!(u.has_5h || u.has_7d);
            }
            Err(e) => panic!("codex fetch failed: {e}"),
        }
    }

    // 実エンドポイントを叩く実測テスト（このPCの実トークンを使用）。
    // 通常は無視。実行: cargo test real_claude_usage -- --ignored --nocapture
    // 秘密のトークンは出力しない。数値のみ表示する。
    #[test]
    #[ignore]
    fn real_claude_usage() {
        match fetch_claude_usage() {
            Ok(u) => {
                println!(
                    "REAL Claude usage: 5h={:.1}% (reset_ms={}) 7d={:.1}% (reset_ms={}) scoped=[{}] {:.1}% overage={}",
                    u.session_pct, u.session_reset, u.weekly_pct, u.weekly_reset, u.scoped_label, u.scoped_pct, u.overage_enabled
                );
                println!("EVENT JSON (フロントへ流れる実ペイロード): {}", claude_usage_event_json(&u));
                assert!((0.0..=100.0).contains(&u.session_pct));
                assert!((0.0..=100.0).contains(&u.weekly_pct));
            }
            Err(e) => panic!("fetch failed: {e}"),
        }
    }
}
