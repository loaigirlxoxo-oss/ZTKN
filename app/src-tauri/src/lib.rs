use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// センサーサイドカー(.NET)の実行ファイルパスを解決する。
// dev では src-tauri/binaries（CARGO_MANIFEST_DIR 基準）。
fn sidecar_path() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("binaries");
    p.push("sensor-sidecar-x86_64-pc-windows-msvc.exe");
    p
}

// サイドカーを子プロセスとして起動し、stdout の JSON 行を "sensors" イベントで
// フロントへ転送する。プロセスが落ちたら指数バックオフで再起動する（握りつぶさず通知）。
fn start_sensor_sidecar(app: AppHandle) {
    std::thread::spawn(move || {
        let path = sidecar_path();
        let mut backoff = 1u64;
        loop {
            match Command::new(&path)
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
            {
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

fn panels_dir() -> PathBuf {
    let mut dir = dirs::home_dir().expect("home dir");
    dir.push("PCStatusPanels");
    dir
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
        .filter(|p| {
            p.extension()
                .and_then(|x| x.to_str())
                .map(|x| matches!(x.to_ascii_lowercase().as_str(), "png" | "jpg" | "jpeg" | "webp"))
                .unwrap_or(false)
        })
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

fn is_image(p: &std::path::Path) -> bool {
    p.extension()
        .and_then(|x| x.to_str())
        .map(|x| matches!(x.to_ascii_lowercase().as_str(), "png" | "jpg" | "jpeg" | "webp"))
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let _ = std::fs::create_dir_all(assets_dir()); // 起動時にAssetsを必ず用意
            start_sensor_sidecar(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet, save_panel, load_panel, read_text_file, list_dir_images,
            assets_root, open_assets_dir, list_asset_sets
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
