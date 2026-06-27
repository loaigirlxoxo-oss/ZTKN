use std::path::PathBuf;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, save_panel, load_panel])
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
