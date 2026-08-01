// AI ツールのプラン使用量(残量%・リセット時刻)を取得するコレクタ。
// - Claude  : /api/oauth/usage REST API（OAuth token 認証）
// - Codex   : ローカル CLI app-server への stdio JSON-RPC
// - Antigravity: ローカル language_server プロセスへの HTTPS（自己署名 TLS）
// 非公開/内部 API が多いので防御的にパースし、失敗はソフトに扱う。

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

// 全 AI ツールを1つの usage イベントにまとめる。常に全部入りで出す（片方だけ出すともう片方が消えるため）。
pub fn usage_event_json(
    claude: Option<&ClaudeUsage>,
    codex: Option<&CodexUsage>,
    antigravity: Option<&AntigravityUsage>,
) -> String {
    let mut sensors: Vec<Value> = vec![];
    if let Some(c) = claude { sensors.extend(claude_sensors(c)); }
    if let Some(c) = codex { sensors.extend(codex_sensors(c)); }
    if let Some(a) = antigravity { sensors.extend(antigravity_sensors(a)); }
    json!({ "source": "usage", "sensors": sensors }).to_string()
}

// 起動時シード等で Claude 単体を出す薄いラッパ。
pub fn claude_usage_event_json(u: &ClaudeUsage) -> String {
    usage_event_json(Some(u), None, None)
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

// ---- Antigravity (Google) の使用量 ----
// ag-quota VSCode 拡張 (henrikdev.ag-quota) のプロトコルを Rust で再現。
// language_server_windows_x64.exe のコマンドライン引数から port/token を取得し、
// ローカル HTTPS (自己署名証明書) で GetUserStatus を呼ぶ。

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct AntigravityUsage {
    pub credits_used_pct: Option<f64>, // 月間プロンプトクレジット使用率 0..100
    pub models: Vec<AgModel>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct AgModel {
    pub label: String,
    pub used_pct: f64,  // (1 - remainingFraction) * 100
    pub reset_ms: i64,
}

fn antigravity_sensors(u: &AntigravityUsage) -> Vec<Value> {
    let mut s = vec![];
    if let Some(pct) = u.credits_used_pct {
        s.push(json!({
            "id": "Antigravity|クレジット使用率|Usage",
            "name": "クレジット使用率",
            "hw": "Antigravity",
            "type": "Usage",
            "unit": "%",
            "value": pct
        }));
    }
    for m in &u.models {
        s.push(json!({
            "id": format!("Antigravity|{}|Usage", m.label),
            "name": m.label.clone(),
            "hw": "Antigravity",
            "type": "Usage",
            "unit": "%",
            "value": m.used_pct
        }));
        if m.reset_ms > 0 {
            s.push(json!({
                "id": format!("Antigravity|{} リセット|Reset", m.label),
                "name": format!("{} リセット", m.label),
                "hw": "Antigravity",
                "type": "Reset",
                "unit": "",
                "value": m.reset_ms
            }));
        }
    }
    s
}

// コマンドライン文字列から `--flag` の値を抽出する（`--flag=val` / `--flag val` 両形式対応）。
fn extract_cmdline_arg(cmd: &str, flag: &str) -> Option<String> {
    let cmd_lower = cmd.to_ascii_lowercase();
    let flag_lower = flag.to_ascii_lowercase();
    let pos = cmd_lower.find(&flag_lower)?;
    let after = cmd[pos + flag.len()..].trim_start_matches(['=', ' ', '\t']);
    let end = after.find(|c: char| c.is_whitespace()).unwrap_or(after.len());
    let val = after[..end].trim().to_string();
    if val.is_empty() { None } else { Some(val) }
}

fn is_antigravity_process(cmd: &str) -> bool {
    let lower = cmd.to_ascii_lowercase();
    lower.contains("--app_data_dir antigravity")
        || lower.contains("\\antigravity\\")
        || lower.contains("/antigravity/")
}

// language_server_windows_x64.exe のプロセスリストから (pid, extension_port, csrf_token) を取得。
#[cfg(windows)]
fn find_ag_process() -> Option<(u32, u16, String)> {
    let ps = r#"Get-CimInstance Win32_Process -Filter "name='language_server.exe'" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"#;
    let mut cmd = Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", ps]);
    cmd.stdout(Stdio::piped()).stderr(Stdio::null());
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let out = cmd.output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let text = text.trim();
    if text.is_empty() { return None; }
    let v: Value = serde_json::from_str(text).ok()?;
    let items: Vec<&Value> = match v.as_array() {
        Some(arr) => arr.iter().collect(),
        None => vec![&v],
    };
    for item in items {
        let cmd_line = item["CommandLine"].as_str().unwrap_or("");
        if !is_antigravity_process(cmd_line) { continue; }
        let pid = item["ProcessId"].as_u64()? as u32;
        let port: u16 = extract_cmdline_arg(cmd_line, "--https_server_port")
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let token = extract_cmdline_arg(cmd_line, "--csrf_token")?;
        return Some((pid, port, token));
    }
    None
}

// PID がリッスン中の TCP ポート一覧を返す。
#[cfg(windows)]
fn get_ag_listening_ports(pid: u32) -> Vec<u16> {
    let ps = format!(
        "Get-NetTCPConnection -OwningProcess {pid} -State Listen | Select-Object -ExpandProperty LocalPort | ConvertTo-Json -Compress"
    );
    let mut cmd = Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", ps.as_str()]);
    cmd.stdout(Stdio::piped()).stderr(Stdio::null());
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let out = match cmd.output() { Ok(o) => o, Err(_) => return vec![] };
    let text = String::from_utf8_lossy(&out.stdout);
    let v: Value = match serde_json::from_str(text.trim()) { Ok(v) => v, Err(_) => return vec![] };
    let mut ports = vec![];
    match &v {
        Value::Array(arr) => { for x in arr { if let Some(p) = x.as_u64() { ports.push(p as u16); } } }
        Value::Number(n) => { if let Some(p) = n.as_u64() { ports.push(p as u16); } }
        _ => {}
    }
    ports.sort();
    ports
}

// ポートが実際に Antigravity の API ポートか簡易ヘルスチェック。
fn test_ag_port(port: u16, token: &str) -> bool {
    let Ok(tls) = native_tls::TlsConnector::builder()
        .danger_accept_invalid_certs(true)
        .build()
    else { return false; };
    let agent = ureq::AgentBuilder::new()
        .tls_connector(std::sync::Arc::new(tls))
        .timeout_connect(Duration::from_secs(2))
        .timeout_read(Duration::from_secs(3))
        .build();
    let url = format!(
        "https://127.0.0.1:{port}/exa.language_server_pb.LanguageServerService/GetUnleashData"
    );
    agent.post(&url)
        .set("Content-Type", "application/json")
        .set("Connect-Protocol-Version", "1")
        .set("X-Codeium-Csrf-Token", token)
        .send_string(r#"{"wrapper_data":{}}"#)
        .is_ok()
}

pub fn parse_antigravity_usage(body: &str) -> Result<AntigravityUsage, String> {
    let v: Value = serde_json::from_str(body).map_err(|e| format!("json: {e}"))?;
    let us = &v["userStatus"];

    let credits_used_pct = {
        let monthly = us["planStatus"]["planInfo"]["monthlyPromptCredits"].as_f64().unwrap_or(0.0);
        let available = us["planStatus"]["availablePromptCredits"].as_f64().unwrap_or(0.0);
        if monthly > 0.0 {
            Some(((monthly - available) / monthly * 100.0).clamp(0.0, 100.0))
        } else {
            None
        }
    };

    let models = if let Some(arr) = us["cascadeModelConfigData"]["clientModelConfigs"].as_array() {
        arr.iter()
            .filter(|m| m["quotaInfo"].is_object())
            .filter_map(|m| {
                let label = m["label"].as_str()?.to_string();
                let remaining = m["quotaInfo"]["remainingFraction"].as_f64().unwrap_or(1.0);
                let reset_ms = iso_to_epoch_ms(&m["quotaInfo"]["resetTime"]);
                Some(AgModel {
                    label,
                    used_pct: ((1.0 - remaining) * 100.0).clamp(0.0, 100.0),
                    reset_ms,
                })
            })
            .collect()
    } else {
        vec![]
    };

    Ok(AntigravityUsage { credits_used_pct, models })
}

#[cfg(windows)]
pub fn fetch_antigravity_usage() -> Result<AntigravityUsage, String> {
    let (pid, ext_port, token) =
        find_ag_process().ok_or("Antigravity: language_server not found (not running?)")?;

    // extension_port を優先。候補がなければ全 Listen ポートをスキャン。
    let mut candidates: Vec<u16> = vec![];
    if ext_port > 0 { candidates.push(ext_port); }
    for p in get_ag_listening_ports(pid) { if p != ext_port { candidates.push(p); } }

    let port = candidates
        .into_iter()
        .find(|&p| test_ag_port(p, &token))
        .ok_or_else(|| format!("Antigravity: no responding port (PID={pid})"))?;

    let tls = native_tls::TlsConnector::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| format!("tls: {e}"))?;
    let agent = ureq::AgentBuilder::new()
        .tls_connector(std::sync::Arc::new(tls))
        .timeout_connect(Duration::from_secs(3))
        .timeout_read(Duration::from_secs(5))
        .build();

    let url = format!(
        "https://127.0.0.1:{port}/exa.language_server_pb.LanguageServerService/GetUserStatus"
    );
    let body = json!({
        "metadata": { "ideName": "antigravity", "extensionName": "antigravity", "locale": "en" }
    })
    .to_string();

    let resp = agent
        .post(&url)
        .set("Content-Type", "application/json")
        .set("Connect-Protocol-Version", "1")
        .set("X-Codeium-Csrf-Token", &token)
        .send_string(&body)
        .map_err(|e| format!("request: {e}"))?;

    parse_antigravity_usage(&resp.into_string().map_err(|e| format!("body: {e}"))?)
}

#[cfg(not(windows))]
pub fn fetch_antigravity_usage() -> Result<AntigravityUsage, String> {
    Err("Antigravity: Windows only".into())
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
                println!("EVENT JSON: {}", usage_event_json(None, Some(&u), None));
                assert!(u.has_5h || u.has_7d);
            }
            Err(e) => panic!("codex fetch failed: {e}"),
        }
    }

    #[test]
    fn antigravity_parse_credits_and_models() {
        let body = r#"{
            "userStatus": {
                "planStatus": {
                    "planInfo": { "monthlyPromptCredits": 1000 },
                    "availablePromptCredits": 750
                },
                "cascadeModelConfigData": {
                    "clientModelConfigs": [
                        {
                            "label": "Cascade Base",
                            "quotaInfo": { "remainingFraction": 0.8, "resetTime": "2026-07-25T00:00:00Z" }
                        },
                        {
                            "label": "Cascade Frontier",
                            "quotaInfo": { "remainingFraction": 0.3, "resetTime": "2026-07-25T00:00:00Z" }
                        }
                    ]
                }
            }
        }"#;
        let u = parse_antigravity_usage(body).unwrap();
        assert_eq!(u.credits_used_pct, Some(25.0)); // (1000-750)/1000*100
        assert_eq!(u.models.len(), 2);
        assert_eq!(u.models[0].label, "Cascade Base");
        assert!((u.models[0].used_pct - 20.0).abs() < 0.01); // (1-0.8)*100
        assert_eq!(u.models[1].label, "Cascade Frontier");
        assert!((u.models[1].used_pct - 70.0).abs() < 0.01); // (1-0.3)*100
        assert!(u.models[0].reset_ms > 0);
    }

    #[test]
    fn antigravity_parse_no_credits_no_models() {
        let u = parse_antigravity_usage(r#"{"userStatus":{}}"#).unwrap();
        assert!(u.credits_used_pct.is_none());
        assert!(u.models.is_empty());
    }

    #[test]
    fn antigravity_sensors_emits_correct_ids() {
        let u = AntigravityUsage {
            credits_used_pct: Some(25.0),
            models: vec![AgModel { label: "Frontier".into(), used_pct: 70.0, reset_ms: 1_700_000_000_000 }],
        };
        let s = antigravity_sensors(&u);
        assert_eq!(s.len(), 3); // credits + model_pct + model_reset
        assert_eq!(s[0]["id"], "Antigravity|クレジット使用率|Usage");
        assert_eq!(s[0]["hw"], "Antigravity");
        assert_eq!(s[0]["value"], 25.0);
        assert_eq!(s[1]["id"], "Antigravity|Frontier|Usage");
        assert_eq!(s[2]["id"], "Antigravity|Frontier リセット|Reset");
        assert_eq!(s[2]["type"], "Reset");
    }

    // 実 Antigravity プロセスを叩く実測テスト（Antigravity 起動中のみ動作）。
    // 実行: cargo test real_antigravity_usage -- --ignored --nocapture
    #[test]
    #[ignore]
    fn real_antigravity_usage() {
        match fetch_antigravity_usage() {
            Ok(u) => {
                println!("REAL Antigravity: credits={:?}%", u.credits_used_pct);
                for m in &u.models {
                    println!("  model={} used={:.1}% reset_ms={}", m.label, m.used_pct, m.reset_ms);
                }
                assert!(u.credits_used_pct.is_some() || !u.models.is_empty());
            }
            Err(e) => panic!("antigravity fetch failed: {e}"),
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
