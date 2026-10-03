use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter, Manager};

mod aihooks; // Claude/Codex のフック設定の導入・削除
mod audio; // 出力音声のループバック取り込み(VUメーター用)
mod live; // 画面が取りに来る最新値（センサー・AI使用量・承認待ち）
mod webmem; // ページを描くプロセスのメモリ（溜まったら読み込み直すため）
mod codexapp; // Codex アプリ(フック非対応)の実行中をセッション記録から検出
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

// 起動中のサイドカーの PID。再起動ボタンから止めるために保持する。
// GPU のハンドルはドライバのリセットやスリープ復帰で無効になることがあり、その後は
// 値が 0 のまま返り続ける。復旧手段はプロセスの起動し直しだけなので、手動で行えるようにする。
static SIDECAR_PID: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

// サイドカーが固まったと判断するまでの時間。送出間隔は 0.5 秒なので、15 秒黙っていれば異常。
const SIDECAR_STALL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
// 最初の1行まで。LHM の Open は機種によって数秒〜十数秒かかる。
const SIDECAR_FIRST_LINE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

// サイドカーを子プロセスとして起動し、stdout の JSON 行を "sensors" イベントで
// フロントへ転送する。プロセスが落ちたら指数バックオフで再起動する（握りつぶさず通知）。
fn start_sensor_sidecar(app: AppHandle) {
    std::thread::spawn(move || {
        let path = sidecar_path(&app);
        let mut backoff = 1u64;
        loop {
            let mut cmd = Command::new(&path);
            // 第2引数は PC 全体の電力推定に使う部品構成（無ければサイドカーが既定値を使う）。
            cmd.arg("500").arg(pc_profile_path());
            // 親（このアプリ）の PID。アプリが落ちてもサイドカーが取り残されないよう、消えたら自分で終わる。
            cmd.arg("--parent").arg(std::process::id().to_string());
            // メモリ温度は SMBus を使う。他のソフトと取り合うと詰まることがあるので、選んだときだけ。
            if load_sensor_options().memory_temperature {
                cmd.arg("--memory-temps");
            }
            cmd.stdout(Stdio::piped()).stderr(Stdio::null());
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW: サイドカーの真っ黒なコンソール窓を出さない
            }
            match cmd.spawn() {
                Ok(mut child) => {
                    backoff = 1;
                    SIDECAR_PID.store(child.id(), std::sync::atomic::Ordering::Relaxed);
                    let _ = app.emit("sensor-status", "connected");
                    if let Some(out) = child.stdout.take() {
                        // イベントで送らず最新値として置く。画面が取りに来る（live.rs の説明）。
                        let end = pump_lines(out, SIDECAR_FIRST_LINE_TIMEOUT, SIDECAR_STALL_TIMEOUT, |l| {
                            live::publish("sensors", l);
                        });
                        if let PumpEnd::Stalled(secs) = end {
                            eprintln!("[sidecar] {secs}秒出力が無いので起動し直す");
                            let _ = app.emit("sensor-status", "stalled");
                            let _ = child.kill(); // 自分が起動した子プロセスだけ
                        }
                    }
                    // ドライバ（PawnIO）の中で止まったプロセスは、強制終了しても消えない。
                    // そこで新しく起動すると、同じところで止まったプロセスが増えていくだけ
                    // （別PCで PawnIO ごと固まった）。消えるまでは次を起動せず、理由を出して待つ。
                    if !wait_exit(&mut child, std::time::Duration::from_secs(10)) {
                        eprintln!("[sidecar] 終了しない。ドライバが応答していない");
                        let _ = app.emit("sensor-status", "driver-hung");
                        while !wait_exit(&mut child, std::time::Duration::from_secs(30)) {}
                    }
                    SIDECAR_PID.store(0, std::sync::atomic::Ordering::Relaxed);
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

// 子プロセスの終了を最大 timeout だけ待つ。終了していれば true。
fn wait_exit(child: &mut std::process::Child, timeout: std::time::Duration) -> bool {
    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return true,
            Ok(None) if start.elapsed() < timeout => std::thread::sleep(std::time::Duration::from_millis(200)),
            Ok(None) => return false,
            Err(_) => return true, // 状態が取れないものは待ち続けない
        }
    }
}

#[derive(Debug, PartialEq)]
enum PumpEnd {
    /// 相手が出力を閉じた（終了した）。
    Closed,
    /// 指定秒数のあいだ1行も来なかった。
    Stalled(u64),
}

// サイドカーの出力を1行ずつ渡す。読み取りは別スレッドに任せ、ここでは時間切れ付きで待つ。
// サイドカーが終了せずに固まる（ドライバ呼び出しから戻らない等）と、直接 lines() を回すと
// 永遠に待ち続け、再起動もされない。別PCで数日後にセンサーだけ止まったのはこの経路と見ている。
// Stalled が返ったら、呼び出し側が子プロセスを止める（止めると読み取りスレッドも抜ける）。
fn pump_lines<R: std::io::Read + Send + 'static>(
    out: R,
    first_timeout: std::time::Duration,
    stall_timeout: std::time::Duration,
    mut on_line: impl FnMut(String),
) -> PumpEnd {
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    std::thread::spawn(move || {
        for line in BufReader::new(out).lines() {
            match line {
                Ok(l) => {
                    if tx.send(l).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });
    let mut first = true;
    loop {
        let limit = if first { first_timeout } else { stall_timeout };
        match rx.recv_timeout(limit) {
            Ok(l) => {
                first = false;
                if !l.is_empty() {
                    on_line(l);
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => return PumpEnd::Stalled(limit.as_secs()),
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return PumpEnd::Closed,
        }
    }
}

// センサーを読み直す。サイドカーを終了させるだけで、上のループが自動で起動し直す。
// 自分が起動した子プロセスの PID だけを対象にする。
#[tauri::command]
fn restart_sensor_sidecar() -> Result<(), String> {
    let pid = SIDECAR_PID.load(std::sync::atomic::Ordering::Relaxed);
    if pid == 0 {
        return Err("センサーが起動していません（まもなく自動で起動します）".into());
    }
    let mut cmd = Command::new("taskkill");
    cmd.args(["/PID", &pid.to_string(), "/F"]).stdout(Stdio::null()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let out = cmd.output().map_err(|e| format!("停止に失敗: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

// センサーの読み方の設定。アプリ基準の ztkn-settings.json に置く（Panels と同じ場所）。
#[derive(serde::Serialize, serde::Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase", default)]
struct SensorOptions {
    /// メモリモジュールの温度を読む。SMBus を PawnIO 経由で使うので、RGB 制御ソフトなどと
    /// 取り合うとドライバごと詰まることがある。既定はオフ。
    memory_temperature: bool,
}

fn settings_path() -> PathBuf {
    let mut d = assets_dir();
    d.pop();
    d.push("ztkn-settings.json");
    d
}

fn load_sensor_options() -> SensorOptions {
    std::fs::read_to_string(settings_path())
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

#[tauri::command]
fn get_sensor_options() -> SensorOptions {
    load_sensor_options()
}

// 保存してサイドカーを起動し直す（起動時の引数で反映されるため）。
#[tauri::command]
fn set_sensor_options(memory_temperature: bool) -> Result<SensorOptions, String> {
    let opts = SensorOptions { memory_temperature };
    let json = serde_json::to_string_pretty(&opts).map_err(|e| e.to_string())?;
    std::fs::write(settings_path(), json).map_err(|e| format!("設定を保存できない: {e}"))?;
    // 起動していなければ、次の自動起動で新しい設定が使われる
    let _ = restart_sensor_sidecar();
    Ok(opts)
}

// PC 固有の部品構成（電力推定用）。Panels と同じくアプリ基準に置く（debug=app/, 製品=exe と同じ場所）。
fn pc_profile_path() -> PathBuf {
    let mut d = assets_dir();
    d.pop();
    d.push("pc-profile.json");
    d
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

// 注意: かつて read_text_file / list_dir_images を公開していたが、任意パスを無制限に
// 読めるため削除した（5a5bfe3 で AIDA64 外部取込を廃止した際の消し残りで、呼び出し元は無い）。
// アセットは Assets/ 配下のみを list_asset_sets / list_images で読む。

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

// 全 AI ツール使用量を定期取得して "usage" イベントで流すバックグラウンドポーラー。
// 実センサー("sensors")とは別イベント＝値マップを潰さない。全ツール常に一括で出す
// （usageValues は差し替え方式なので一部だけ出すと他が消えるため）。失敗はログのみ。
//
// 取得間隔は全ツール5分。使用量は5時間/7日枠なので分単位で追う必要がなく、
// リセットまでの残り時間はフロントが epoch から毎フレーム計算するため再取得も不要。
// Claude API は 429 を返すことがあるので指数バックオフを入れる（毎分叩き続けると
// 制限が解除されず張り付いたままになる）。
const USAGE_TICK_SECS: u64 = 60;
const USAGE_INTERVAL_TICKS: u64 = 5; // 5分
const BACKOFF_MAX_TICKS: u64 = 60; // 上限1時間

fn start_usage_poller() {
    std::thread::spawn(move || {
        // 直近値をキャッシュ＝一時的な取得失敗でも前回値を出し続ける（表示が消えない）。
        let mut claude_cache: Option<usage::ClaudeUsage> = None;
        let mut codex_cache: Option<usage::CodexUsage> = None;
        let mut ag_cache: Option<usage::AntigravityUsage> = None;
        let mut tick = 0u64;
        let mut claude_next = 0u64; // 次に Claude を取得するtick
        let mut claude_backoff = 0u64; // 連続失敗時の追加待ち(tick)
        loop {
            if tick >= claude_next {
                match usage::fetch_claude_usage() {
                    Ok(u) => {
                        claude_cache = Some(u);
                        claude_backoff = 0;
                        claude_next = tick + USAGE_INTERVAL_TICKS;
                    }
                    Err(e) => {
                        eprintln!("[usage] claude: {e}");
                        // 失敗するほど間隔を倍にする（5,10,20,40,60...分）
                        claude_backoff = (claude_backoff.max(USAGE_INTERVAL_TICKS) * 2).min(BACKOFF_MAX_TICKS);
                        claude_next = tick + claude_backoff;
                    }
                }
            }
            if tick % USAGE_INTERVAL_TICKS == 0 {
                match usage::fetch_codex_usage() {
                    Ok(c) => codex_cache = Some(c),
                    Err(e) => eprintln!("[usage] codex: {e}"),
                }
                match usage::fetch_antigravity_usage() {
                    Ok(a) => ag_cache = Some(a),
                    Err(e) => eprintln!("[usage] antigravity: {e}"),
                }
            }
            live::publish(
                "usage",
                usage::usage_event_json(claude_cache.as_ref(), codex_cache.as_ref(), ag_cache.as_ref()),
            );
            tick += 1;
            std::thread::sleep(std::time::Duration::from_secs(USAGE_TICK_SECS));
        }
    });
}


// 状態ファイルを「古い」とみなすまでの時間。
// running は Stop フックで消えるのが正常系なので、消え残りより「実行中なのに出ない」を避けたい。
// 単一のツール実行が長引いても消えないよう長めに取る。
const RUNNING_STALE_SECS: u64 = 3600; // 1時間
const WAITING_STALE_SECS: u64 = 900; // 15分（承認を放置した場合の掃除）

// 承認の判断に入って(pending)からこの時間、状態が更新されなければ承認待ちとみなす。
//
// 本来は Notification(permission_prompt) で確実に判定したいが、VS Code 拡張では
// このフックが発火しない（anthropics/claude-code の複数Issueで報告済みの未修正不具合）。
// PermissionRequest はブロックしていなくても毎回発火するため単独では使えない(#29212)。
// フックから見ると「承認待ちで停止中」と「承認済みで長いツールを実行中」は
// 完全に同じ signature になるため、時間で推測するしかない。
//
// 副作用: この時間より長くかかるツール実行は承認待ちと誤判定される。
// 短くすると誤判定が増え、長くすると気付くのが遅れる。
const PENDING_TO_WAIT_SECS: u64 = 30;

// pending 印が付いたまま一定時間が経っていれば承認待ちへ昇格する。
fn effective_status(status: &str, pending: bool, ts: u64, now: u64) -> &'static str {
    if status == "waiting" {
        return "waiting";
    }
    if pending && now.saturating_sub(ts) >= PENDING_TO_WAIT_SECS {
        return "waiting";
    }
    "running"
}

// 状態ファイルを一覧に出すか。時間だけで判定する。
//
// 状態ファイルには pid も記録されているが、判定には使わない。フックの祖先を辿って
// 得た PID は CLI の起動方法によって短命プロセス（フック実行用のシェル等）を指し、
// 記録直後には既に終了していることを実測で確認した。さらに Windows が PID を再利用すると
// 無関係なプロセスを根拠に古い状態が無期限に残る。生存確認は根拠にならない。
//
// 正常系は Stop フックがファイルを消すので、ここの時間判定は
// クラッシュ等で消し残った分の掃除にあたる。
fn should_show(status: &str, ts: u64, now: u64) -> bool {
    let stale_after = if status == "running" { RUNNING_STALE_SECS } else { WAITING_STALE_SECS };
    now.saturating_sub(ts) <= stale_after
}

// ~/.claude/ztkn-state/*.json を読み、承認待ちセッション一覧を返す。
// 表示対象外まで古くなったファイルはここで削除する。フックは Stop でしか消さないため、
// クラッシュや無効化中に終わったセッションの分が溜まり続けてしまう
// （放置すると実際に数週間分残っていた）。生きているセッションのものは
// 次のフック発火で書き直されるので、消しても実害はない。
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
                let Ok(v) = serde_json::from_str::<serde_json::Value>(&txt) else {
                    // フックは書き込み時にファイルを切り詰めてから書くため、その最中に読むと
                    // 途中までのJSONが見える。これを「壊れている」と判断して消すと、
                    // 生きているセッションの状態を毎秒の走査で削除しかねない。
                    // 十分古いものだけ本当に壊れているとみなして掃除する。
                    let old = std::fs::metadata(&p)
                        .and_then(|m| m.modified())
                        .ok()
                        .and_then(|t| t.elapsed().ok())
                        .map(|d| d.as_secs() > WAITING_STALE_SECS)
                        .unwrap_or(false);
                    if old {
                        let _ = std::fs::remove_file(&p);
                    }
                    continue;
                };
                let ts = v["ts"].as_u64().unwrap_or(0);
                let raw_status = v["status"].as_str().unwrap_or("waiting");
                // 承認の判断に入ったまま一定時間動きが無ければ承認待ちとみなす
                let status = effective_status(raw_status, v["pending"].as_bool().unwrap_or(false), ts, now);
                if !should_show(status, ts, now) {
                    let _ = std::fs::remove_file(&p); // 期限切れ＝もう更新されないので消す
                    continue;
                }
                // cwd はフルパス（非公開プロジェクト名やユーザー名を含む）なのでフロントへ渡さない。
                // 表示に必要な末尾のフォルダ名だけを取り出す。
                let folder = std::path::Path::new(v["cwd"].as_str().unwrap_or(""))
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_string();
                list.push(serde_json::json!({
                    "session_id": v["session_id"].as_str().unwrap_or(""),
                    "folder": folder,
                    "since": ts,
                    "provider": v["provider"].as_str().unwrap_or("claude"),
                    "status": status,
                }));
            }
        }
    }
    // Codex アプリはフックを実行しないため、セッション記録から実行中を拾って足す。
    // フック経由(CLI)で既に同じセッションが入っていれば重複させない。
    for t in codexapp::running_threads() {
        if list.iter().any(|a| a["session_id"].as_str() == Some(t.session_id.as_str())) {
            continue;
        }
        let folder = std::path::Path::new(t.cwd.trim_start_matches(r"\\?\"))
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        list.push(serde_json::json!({
            "session_id": t.session_id,
            "folder": folder,
            "since": t.since,
            "provider": "codex",
            "status": "running",
        }));
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

// AI連携フック（Claude/Codex の設定ファイルへの書き込み）の状態取得・切り替え。
#[tauri::command]
fn ai_hooks_status() -> aihooks::AiHookStatus {
    aihooks::status()
}

#[tauri::command]
fn set_ai_hooks(enable: bool) -> Result<aihooks::AiHookStatus, String> {
    if enable { aihooks::enable() } else { aihooks::disable() }
}

// 起動直後の種（poller初回emit取り逃し対策）。フォルダ一覧JSONを返す。
#[tauri::command]
fn get_agent_alerts() -> String {
    serde_json::to_string(&read_agent_alerts_list()).unwrap_or_else(|_| "[]".into())
}

// 承認待ちを定期配信するポーラー（1秒）。件数(usageセンサー) と 待ちフォルダ一覧 の両方を流す。
fn start_agent_alert_poller() {
    std::thread::spawn(move || loop {
        let list = read_agent_alerts_list();
        live::publish("agent-usage", agent_count_usage_json(&list)); // A: 件数センサー（Claude/Codex別）
        live::publish(
            "agent-alerts",
            serde_json::to_string(&list).unwrap_or_else(|_| "[]".into()),
        ); // B: フォルダ一覧（AlertList部品用）
        std::thread::sleep(std::time::Duration::from_secs(1));
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
            start_usage_poller(); // AI使用量を定期取得して "usage" で配信
            start_agent_alert_poller(); // 承認待ちを live の "agent-alerts" に置く
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
            save_panel, load_panel, list_panels,
            assets_root, open_assets_dir, list_asset_sets, list_fonts, list_images, open_images_dir,
            get_claude_usage_event, get_agent_alerts, ai_hooks_status, set_ai_hooks,
            restart_sensor_sidecar,
            audio::audio_start, audio::audio_stop, audio::audio_status, audio::audio_frame,
            live::get_live, get_sensor_options, set_sensor_options, webmem::renderer_memory_mb
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 1行出したあと固まる相手。固まっている間 read から戻らない。
    struct StallAfterFirst { sent: bool }
    impl std::io::Read for StallAfterFirst {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            if !self.sent {
                self.sent = true;
                let b = b"line1
";
                buf[..b.len()].copy_from_slice(b);
                return Ok(b.len());
            }
            std::thread::sleep(std::time::Duration::from_secs(2));
            Ok(0)
        }
    }

    // サイドカーが終了せずに黙り込んだら、時間切れで抜けて再起動へ回ること。
    #[test]
    fn pump_detects_stalled_sidecar() {
        let mut got = Vec::new();
        let ms = std::time::Duration::from_millis;
        let end = pump_lines(StallAfterFirst { sent: false }, ms(1000), ms(300), |l| got.push(l));
        assert_eq!(got, vec!["line1".to_string()]);
        assert!(matches!(end, PumpEnd::Stalled(_)));
    }

    // 普通に終了したときは Closed で抜け、出た行は全部渡ること。
    #[test]
    fn pump_returns_closed_when_sidecar_exits() {
        let mut got = Vec::new();
        let ms = std::time::Duration::from_millis;
        let end = pump_lines(std::io::Cursor::new(b"a

b
".to_vec()), ms(1000), ms(1000), |l| got.push(l));
        assert_eq!(got, vec!["a".to_string(), "b".to_string()]);
        assert_eq!(end, PumpEnd::Closed);
    }

    // 実行中/承認待ちの表示判定。PIDを「死亡＝除外」に使うと実行中が一切出なくなる
    // （フックの祖先PIDは短命プロセスを指すため）ので、その退行を防ぐ。
    // 承認の判断に入ってから動きが無ければ承認待ちへ昇格する。
    // VS Code 拡張では Notification が発火しないため、時間で推測するしかない。
    #[test]
    fn pending_becomes_waiting_after_threshold() {
        let now = 1_000_000u64;
        // 判断直後はまだ実行中扱い（自動承認なら即ツールが動く）
        assert_eq!(effective_status("running", true, now - 1, now), "running");
        assert_eq!(effective_status("running", true, now - 29, now), "running");
        // しきい値を超えたら承認待ち
        assert_eq!(effective_status("running", true, now - 30, now), "waiting");
        assert_eq!(effective_status("running", true, now - 300, now), "waiting");
        // pending が付いていない実行中は、いつまで経っても実行中のまま
        assert_eq!(effective_status("running", false, now - 9999, now), "running");
        // 既に承認待ちならそのまま
        assert_eq!(effective_status("waiting", false, now - 1, now), "waiting");
    }

    #[test]
    fn running_survives_long_tool_execution() {
        let now = 1_000_000u64;
        assert!(should_show("running", now - 10, now));
        // 長時間のツール実行中（30分経過）でも消えない
        assert!(should_show("running", now - 1800, now));
        // 1時間を超えたら消す（クラッシュ放置の掃除）
        assert!(!should_show("running", now - 3601, now));
        // どれだけ古くても必ず消える（PIDの生存を根拠に無期限に残さない）
        assert!(!should_show("running", now - 99999, now));
    }

    #[test]
    fn waiting_is_cleaned_up_after_15min() {
        let now = 1_000_000u64;
        assert!(should_show("waiting", now - 60, now));
        assert!(should_show("waiting", now - 899, now));
        assert!(!should_show("waiting", now - 901, now));
        assert!(!should_show("waiting", now - 99999, now));
    }

    // ts が未来（時計のズレ）でも panic せず表示される
    #[test]
    fn future_timestamp_does_not_panic() {
        assert!(should_show("running", 2_000_000, 1_000_000));
    }

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
