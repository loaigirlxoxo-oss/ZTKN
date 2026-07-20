use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter, Manager};

mod usage; // AI使用量(プラン残量%・5h/7d枠)の取得

// センサーサイドカー(.NET)の実行ファイルパスを解決する。
// 配布版はバンドルされたリソース(resource_dir/sensor-sidecar.exe)、
// dev では src-tauri/binaries（CARGO_MANIFEST_DIR 基準）にフォールバック。
fn sidecar_path(app: &AppHandle) -> PathBuf {
    if let Ok(dir) = app.path().resource_dir() {
        let p = dir.join("sensor-sidecar.exe");
        if p.exists() {
            return p;
        }
    }
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("binaries");
    p.push("sensor-sidecar-x86_64-pc-windows-msvc.exe");
    p
}

// サイドカーを子プロセスとして起動し、stdout の JSON 行を "sensors" イベントで
// フロントへ転送する。プロセスが落ちたら指数バックオフで再起動する（握りつぶさず通知）。
fn start_sensor_sidecar(app: AppHandle) {
    std::thread::spawn(move || {
        let path = sidecar_path(&app);
        let mut backoff = 1u64;
        loop {
            let mut cmd = Command::new(&path);
            cmd.stdout(Stdio::piped()).stderr(Stdio::null());
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW: サイドカーの真っ黒なコンソール窓を出さない
            }
            match cmd.spawn() {
                Ok(mut child) => {
                    backoff = 1;
                    let _ = app.emit("sensor-status", "connected");
                    if let Some(out) = child.stdout.take() {
                        for line in BufReader::new(out).lines() {
                            match line {
                                Ok(l) if !l.is_empty() => {
                                    let _ = app.emit("sensors", l);
                                }
                                Ok(_) => {}
                                Err(_) => break,
                            }
                        }
                    }
                    let _ = child.wait();
                    let _ = app.emit("sensor-status", "disconnected");
                }
                Err(e) => {
                    let _ = app.emit("sensor-status", format!("error: {e}"));
                }
            }
            std::thread::sleep(std::time::Duration::from_secs(backoff));
            backoff = (backoff * 2).min(30);
        }
    });
}

// 保存パネルの置き場。Assets/image と同じ規約でアプリ基準に置く
// （debug=app/Panels, 製品=exe/Panels）。ホームディレクトリには置かない。
fn panels_dir() -> PathBuf {
    let mut d = assets_dir();
    d.pop(); // "Assets" を外して基準ディレクトリへ
    d.push("Panels");
    d
}

#[tauri::command]
fn save_panel(name: String, json: String) -> Result<(), String> {
    let dir = panels_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{name}.json"));
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_panel(name: String) -> Result<String, String> {
    let path = panels_dir().join(format!("{name}.json"));
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

// 保存済みパネル名（PCStatusPanels内の *.json のベース名）を列挙する。
#[tauri::command]
fn list_panels() -> Vec<String> {
    let mut names: Vec<String> = vec![];
    if let Ok(rd) = std::fs::read_dir(panels_dir()) {
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().and_then(|s| s.to_str()) == Some("json") {
                if let Some(stem) = p.file_stem().and_then(|s| s.to_str()) {
                    names.push(stem.to_string());
                }
            }
        }
    }
    names.sort();
    names
}

// 任意のテキストファイルを読む（AIDA64 の layout.json 取り込み等）。
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

// フォルダ内の画像ファイル（png/jpg/jpeg/webp）をファイル名順で絶対パス一覧にする。
// 状態フレームゲージ（state-01..state-16）の取り込みに使う。
#[tauri::command]
fn list_dir_images(dir: String) -> Result<Vec<String>, String> {
    let mut files: Vec<String> = std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| is_image(p))
        .map(|p| p.to_string_lossy().to_string())
        .collect();
    files.sort();
    Ok(files)
}

// ---- アセット管理（exe隣の Assets/ にセット単位で保管） ----

#[derive(serde::Serialize)]
struct AssetSet {
    name: String,
    files: Vec<String>,
}

fn assets_dir() -> PathBuf {
    if cfg!(debug_assertions) {
        // dev: プロジェクトの app/ 直下（target/debug の奥ではなく分かりやすい場所、cargo cleanでも消えない）
        let mut d = PathBuf::from(env!("CARGO_MANIFEST_DIR")); // .../app/src-tauri
        d.pop(); // .../app
        d.push("Assets");
        d
    } else {
        // 製品: インストール済み exe の隣（アプリフォルダ直下）
        let mut d = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|x| x.to_path_buf()))
            .unwrap_or_else(|| PathBuf::from("."));
        d.push("Assets");
        d
    }
}

// 対応画像拡張子（連番ゲージ取り込み・1枚絵一覧で共通）
const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif"];

fn is_image(p: &std::path::Path) -> bool {
    p.extension()
        .and_then(|x| x.to_str())
        .map(|x| IMAGE_EXTS.contains(&x.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn images_in(dir: &std::path::Path) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.is_file() && is_image(p))
        .map(|p| p.to_string_lossy().to_string())
        .collect();
    v.sort();
    v
}

#[tauri::command]
fn assets_root() -> String {
    assets_dir().to_string_lossy().to_string()
}

// エクスプローラで Assets フォルダを開く（無ければ作ってから）。
#[tauri::command]
fn open_assets_dir() -> Result<(), String> {
    let dir = assets_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::process::Command::new("explorer")
        .arg(&dir)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

// 1枚絵の置き場。Assets と並ぶ浅い "image/" フォルダ（debug=app/image, 製品=exe/image）。
fn images_dir() -> PathBuf {
    let mut d = assets_dir();
    d.pop(); // "Assets" を外して基準ディレクトリへ
    d.push("image");
    d
}

// image/ 直下の画像（png/jpg/jpeg/webp）を絶対パス一覧で返す（無ければ作る）。
#[tauri::command]
fn list_images() -> Result<Vec<String>, String> {
    let dir = images_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(images_in(&dir))
}

// エクスプローラで image フォルダを開く（無ければ作ってから）。
#[tauri::command]
fn open_images_dir() -> Result<(), String> {
    let dir = images_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::process::Command::new("explorer").arg(&dir).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

// Assets/ 以下を再帰的にたどり、画像を直接含むフォルダ＝1セットとして集める。
// セット名は Assets からの相対パス（例 "backgrounds", "round/gradient-heat", "bar/barcode-cream"）。
fn collect_sets(base: &std::path::Path, dir: &std::path::Path, out: &mut Vec<AssetSet>) {
    let imgs = images_in(dir);
    if !imgs.is_empty() {
        let name = dir
            .strip_prefix(base)
            .unwrap_or(dir)
            .to_string_lossy()
            .replace('\\', "/");
        out.push(AssetSet { name, files: imgs });
    }
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                collect_sets(base, &p, out);
            }
        }
    }
}

#[tauri::command]
fn list_asset_sets() -> Result<Vec<AssetSet>, String> {
    let root = assets_dir();
    let mut sets: Vec<AssetSet> = vec![];
    if root.exists() {
        for entry in std::fs::read_dir(&root).map_err(|e| e.to_string())? {
            let p = entry.map_err(|e| e.to_string())?.path();
            if p.is_dir() {
                collect_sets(&root, &p, &mut sets);
            }
        }
    }
    sets.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(sets)
}

// Windows にインストール済みのフォントファミリ名を全列挙する。
// GDI+ の InstalledFontCollection を PowerShell 経由で読む（依存クレート追加なし）。
// 日本語フォント名が化けないよう出力エンコーディングを UTF-8 に固定する。
// 注意: 管理者昇格で動くため「ユーザー個別インストール」のフォントは列挙されない
// （全ユーザー向けにインストールされたフォントのみ）。
#[tauri::command]
fn list_fonts() -> Vec<String> {
    let script = "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; \
        Add-Type -AssemblyName System.Drawing; \
        (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }";
    let mut cmd = Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", script]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW: コンソールの一瞬の表示を抑止
    }
    match cmd.output() {
        Ok(o) => {
            let mut v: Vec<String> = String::from_utf8_lossy(&o.stdout)
                .lines()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            v.sort();
            v.dedup();
            v
        }
        Err(_) => vec![],
    }
}

// Claude のプラン使用量を sensor 互換JSONで即時取得する（起動直後の種＝pollerの初回emit取り逃し対策）。
#[tauri::command]
fn get_claude_usage_event() -> Result<String, String> {
    usage::fetch_claude_usage().map(|u| usage::claude_usage_event_json(&u))
}

// Claude+Codex 使用量を定期取得して "usage" イベントで流すバックグラウンドポーラー。
// 実センサー("sensors")とは別イベント＝値マップを潰さない。Claude+Codexは常に一括で出す
// （usageValuesは差し替え方式なので片方だけ出すともう片方が消えるため）。失敗はログのみ。
fn start_usage_poller(app: AppHandle) {
    std::thread::spawn(move || {
        // 直近値をキャッシュ＝一時的な取得失敗でも前回値を出し続ける（表示が消えない）。
        let mut claude_cache: Option<usage::ClaudeUsage> = None;
        let mut codex_cache: Option<usage::CodexUsage> = None;
        let mut tick = 0u64;
        loop {
            match usage::fetch_claude_usage() {
                Ok(u) => claude_cache = Some(u),
                Err(e) => eprintln!("[usage] claude: {e}"), // 未ログイン/オフライン等（キャッシュ維持）
            }
            // Codexは app-server 起動が重いので5分に1回だけ更新（それ以外はキャッシュ値を使う）
            if tick % 5 == 0 {
                match usage::fetch_codex_usage() {
                    Ok(c) => codex_cache = Some(c),
                    Err(e) => eprintln!("[usage] codex: {e}"),
                }
            }
            let _ = app.emit("usage", usage::usage_event_json(claude_cache.as_ref(), codex_cache.as_ref()));
            tick += 1;
            std::thread::sleep(std::time::Duration::from_secs(60));
        }
    });
}

// ~/.claude/ztkn-state/*.json を読み、承認待ちセッション一覧をJSON配列文字列で返す。
// ファイル存在＝承認待ち（フックexeが作成/削除）。ts が古い（クラッシュ放置）は無視する。
fn read_agent_alerts_list() -> Vec<serde_json::Value> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut list: Vec<serde_json::Value> = vec![];
    if let Some(dir) = dirs::home_dir().map(|h| h.join(".claude").join("ztkn-state")) {
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for e in rd.flatten() {
                let p = e.path();
                if p.extension().and_then(|s| s.to_str()) != Some("json") {
                    continue;
                }
                let Ok(txt) = std::fs::read_to_string(&p) else { continue };
                let Ok(v) = serde_json::from_str::<serde_json::Value>(&txt) else { continue };
                let ts = v["ts"].as_u64().unwrap_or(0);
                if now.saturating_sub(ts) > 900 {
                    continue; // 15分以上前＝放置とみなし無視
                }
                let cwd = v["cwd"].as_str().unwrap_or("").to_string();
                let folder = std::path::Path::new(&cwd)
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_string();
                list.push(serde_json::json!({
                    "session_id": v["session_id"].as_str().unwrap_or(""),
                    "folder": folder,
                    "cwd": cwd,
                    "since": ts,
                    "provider": v["provider"].as_str().unwrap_or("claude"),
                    "status": v["status"].as_str().unwrap_or("waiting"),
                }));
            }
        }
    }
    list.sort_by(|a, b| a["folder"].as_str().unwrap_or("").cmp(b["folder"].as_str().unwrap_or("")));
    list
}

// 承認待ち/実行中の件数を usage センサー形式で流す＝普通の部品で置ける。
// グループ(hw)は Claude / Codex に分け、それぞれ「実行中」「承認待ち」の2値を出す。
fn agent_count_usage_json(list: &[serde_json::Value]) -> String {
    let n = |p: &str, s: &str| {
        list.iter()
            .filter(|a| a["provider"].as_str().unwrap_or("claude") == p && a["status"].as_str().unwrap_or("waiting") == s)
            .count()
    };
    let entry = |id: &str, hw: &str, name: &str, value: usize| {
        serde_json::json!({ "id": id, "name": name, "hw": hw, "type": "Alert", "unit": "件", "value": value })
    };
    serde_json::json!({
        "source": "alert",
        "sensors": [
            entry("Claude|実行中|Alert", "Claude", "実行中", n("claude", "running")),
            entry("Claude|承認待ち|Alert", "Claude", "承認待ち", n("claude", "waiting")),
            entry("Codex|実行中|Alert", "Codex", "実行中", n("codex", "running")),
            entry("Codex|承認待ち|Alert", "Codex", "承認待ち", n("codex", "waiting"))
        ]
    })
    .to_string()
}

// 起動直後の種（poller初回emit取り逃し対策）。フォルダ一覧JSONを返す。
#[tauri::command]
fn get_agent_alerts() -> String {
    serde_json::to_string(&read_agent_alerts_list()).unwrap_or_else(|_| "[]".into())
}

// 承認待ちを定期配信するポーラー（~2秒）。件数(usageセンサー) と 待ちフォルダ一覧 の両方を流す。
fn start_agent_alert_poller(app: AppHandle) {
    std::thread::spawn(move || loop {
        let list = read_agent_alerts_list();
        let _ = app.emit("usage", agent_count_usage_json(&list)); // A: 件数センサー（Claude/Codex別）
        let _ = app.emit(
            "agent-alerts",
            serde_json::to_string(&list).unwrap_or_else(|_| "[]".into()),
        ); // B: フォルダ一覧（AlertList部品用）
        std::thread::sleep(std::time::Duration::from_secs(2));
    });
}

// タスクトレイを構築する。左クリック/「表示」でウィンドウを再表示、「終了」でプロセス終了。
fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    use tauri::Manager;

    let show = MenuItem::with_id(app, "show", "表示を開く", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "終了", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let reveal = |app: &tauri::AppHandle| {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.show();
            let _ = w.unminimize();
            let _ = w.set_focus();
        }
    };

    TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().expect("default icon").clone())
        .tooltip("PC Status")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "show" => reveal(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(move |tray, event| {
            // 左クリックでウィンドウを再表示
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                reveal(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // OSログイン時の自動起動（Windowsはレジストリ Run キー）。--minimized 付きで起動。
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .setup(|app| {
            let _ = std::fs::create_dir_all(assets_dir()); // 起動時にAssetsを必ず用意
            let _ = std::fs::create_dir_all(images_dir()); // 1枚絵置き場 image/ も用意
            start_sensor_sidecar(app.handle().clone());
            start_usage_poller(app.handle().clone()); // AI使用量を定期取得して "usage" で配信
            start_agent_alert_poller(app.handle().clone()); // 承認待ちを "agent-alerts" で配信
            setup_tray(app.handle())?; // タスクトレイ常駐
            // 自動起動(--minimized)時はウィンドウを出さずトレイ常駐で開始
            if std::env::args().any(|a| a == "--minimized") {
                use tauri::Manager;
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
            Ok(())
        })
        // 閉じる(×)では終了せずトレイへ格納＝常駐。終了はトレイメニューから。
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            save_panel, load_panel, list_panels, read_text_file, list_dir_images,
            assets_root, open_assets_dir, list_asset_sets, list_fonts, list_images, open_images_dir,
            get_claude_usage_event, get_agent_alerts
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_then_load_roundtrips() {
        let name = "test_panel_roundtrip";
        let json = r#"{"size":{"x":0,"y":0,"w":10,"h":10},"items":[]}"#;
        save_panel(name.to_string(), json.to_string()).unwrap();
        let back = load_panel(name.to_string()).unwrap();
        assert_eq!(back, json);
        // cleanup
        let _ = std::fs::remove_file(panels_dir().join(format!("{name}.json")));
    }
}
