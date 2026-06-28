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
    let mut d = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|x| x.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));
    d.push("Assets");
    d
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

// フォルダ src_dir 内の画像を Assets/<set_name>/ にコピーし、コピー後の画像パス一覧を返す。
#[tauri::command]
fn import_asset_folder(src_dir: String, set_name: String) -> Result<Vec<String>, String> {
    let dest = assets_dir().join(&set_name);
    std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(&src_dir).map_err(|e| e.to_string())? {
        let p = entry.map_err(|e| e.to_string())?.path();
        if p.is_file() && is_image(&p) {
            if let Some(name) = p.file_name() {
                std::fs::copy(&p, dest.join(name)).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(images_in(&dest))
}

// 単一ファイルを Assets/<set_name>/ にコピーし、コピー後の絶対パスを返す。
#[tauri::command]
fn import_asset_file(src_file: String, set_name: String) -> Result<String, String> {
    let dest = assets_dir().join(&set_name);
    std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    let name = std::path::Path::new(&src_file)
        .file_name()
        .ok_or_else(|| "invalid file name".to_string())?;
    let dp = dest.join(name);
    std::fs::copy(&src_file, &dp).map_err(|e| e.to_string())?;
    Ok(dp.to_string_lossy().to_string())
}

// Assets/ 配下のセット一覧（フォルダ名→画像一覧）。
#[tauri::command]
fn list_asset_sets() -> Result<Vec<AssetSet>, String> {
    let root = assets_dir();
    if !root.exists() {
        return Ok(vec![]);
    }
    let mut sets: Vec<AssetSet> = vec![];
    for entry in std::fs::read_dir(&root).map_err(|e| e.to_string())? {
        let p = entry.map_err(|e| e.to_string())?.path();
        if p.is_dir() {
            sets.push(AssetSet {
                name: p.file_name().unwrap().to_string_lossy().to_string(),
                files: images_in(&p),
            });
        }
    }
    sets.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(sets)
}

// AIDA64 素材パック(src_root)を Assets/ にセット単位で取り込む。作成セット名一覧を返す。
#[tauri::command]
fn import_aida64_pack(src_root: String) -> Result<Vec<String>, String> {
    let root = std::path::Path::new(&src_root);
    let mut created: Vec<String> = vec![];

    // 背景（base/variations/preview を backgrounds セットへ）
    for sub in ["backgrounds/base-for-dynamic", "backgrounds/variations", "backgrounds/final-selected-preview"] {
        let dir = root.join(sub);
        if dir.is_dir() {
            let _ = import_asset_folder(dir.to_string_lossy().to_string(), "backgrounds".into());
        }
    }
    if assets_dir().join("backgrounds").is_dir() {
        created.push("backgrounds".into());
    }

    // 丸ゲージ: custom-gauge-states/round/<name>
    let round = root.join("custom-gauge-states/round");
    if round.is_dir() {
        for e in std::fs::read_dir(&round).map_err(|x| x.to_string())? {
            let p = e.map_err(|x| x.to_string())?.path();
            if p.is_dir() {
                let set = format!("round--{}", p.file_name().unwrap().to_string_lossy());
                import_asset_folder(p.to_string_lossy().to_string(), set.clone())?;
                created.push(set);
            }
        }
    }

    // 横バー: custom-gauge-states/horizontal/<style>/<color>
    let horiz = root.join("custom-gauge-states/horizontal");
    if horiz.is_dir() {
        for style_e in std::fs::read_dir(&horiz).map_err(|x| x.to_string())? {
            let style = style_e.map_err(|x| x.to_string())?.path();
            if style.is_dir() {
                for color_e in std::fs::read_dir(&style).map_err(|x| x.to_string())? {
                    let color = color_e.map_err(|x| x.to_string())?.path();
                    if color.is_dir() {
                        let set = format!(
                            "bar--{}-{}",
                            style.file_name().unwrap().to_string_lossy(),
                            color.file_name().unwrap().to_string_lossy()
                        );
                        import_asset_folder(color.to_string_lossy().to_string(), set.clone())?;
                        created.push(set);
                    }
                }
            }
        }
    }

    created.sort();
    Ok(created)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            start_sensor_sidecar(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet, save_panel, load_panel, read_text_file, list_dir_images,
            assets_root, import_asset_folder, import_asset_file, list_asset_sets, import_aida64_pack
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
