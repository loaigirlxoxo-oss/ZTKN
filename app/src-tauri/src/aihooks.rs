// Claude Code / Codex CLI のフック設定を ZTKN 側から導入・削除する。
//
// 利用者の設定ファイルを書き換えるので、次を厳守する:
//  - 既存のフックや設定には一切触れない。ZTKN が入れたものだけを識別して差し替える
//  - Codex の config.toml は手書きの設定とコメントが入っているため、丸ごと再生成せず
//    toml_edit で該当テーブルだけ操作する
//  - 書き込み前に既存ファイルを .ztkn-backup へ退避する（壊した時に戻せるように）
//
// フック実行ファイルは C:\ProgramData\ZTKN\ に配置する。インストール先
// (C:\Program Files\ZTKN\) はパスにスペースを含み、Codex 側のコマンド文字列で
// 引用符がどう解釈されるか仕様が公開されていないため、スペースの無い固定パスへ逃がす。

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Value};

// フックが呼ばれるイベントと、ztkn-hook に渡す動作の対応。
// UserPromptSubmit/PostToolUse=実行中, PermissionRequest=承認待ち, Stop=解除。
const HOOK_EVENTS: [(&str, &str); 4] = [
    ("UserPromptSubmit", "running"),
    ("PermissionRequest", "wait"),
    ("PostToolUse", "running"),
    ("Stop", "clear"),
];

// ZTKN が書いたエントリを見分けるための目印。パスが変わっても拾えるよう実行ファイル名で判定する。
const HOOK_EXE_NAME: &str = "ztkn-hook.exe";

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct AiHookStatus {
    pub claude_enabled: bool,
    pub codex_enabled: bool,
    pub claude_config: String, // 対象ファイルの絶対パス（UIで提示して確認できるように）
    pub codex_config: String,
    pub hook_exe: String,
    pub hook_exe_ready: bool, // 配置済みか
}

// フック実行ファイルの配置先。スペースを含まない固定パスを使う。
pub fn hook_exe_dest() -> PathBuf {
    let base = std::env::var("ProgramData").unwrap_or_else(|_| r"C:\ProgramData".to_string());
    PathBuf::from(base).join("ZTKN").join(HOOK_EXE_NAME)
}

// 配布時は exe の隣（resources）、dev では cargo の成果物を探す。
fn hook_exe_source() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = vec![];
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(HOOK_EXE_NAME));
        }
    }
    if cfg!(debug_assertions) {
        let mut d = PathBuf::from(env!("CARGO_MANIFEST_DIR")); // .../app/src-tauri
        candidates.push(d.join("target").join("debug").join(HOOK_EXE_NAME));
        d.push("target");
        candidates.push(d.join("release").join(HOOK_EXE_NAME));
    }
    candidates.into_iter().find(|p| p.is_file())
}

// Windows パス -> Git Bash のパス。Claude Code は Windows でもフックを bash 経由で実行する。
// 例: C:\ProgramData\ZTKN\ztkn-hook.exe -> /c/ProgramData/ZTKN/ztkn-hook.exe
fn to_git_bash_path(p: &Path) -> String {
    let s = p.to_string_lossy().replace('\\', "/");
    if let Some(rest) = s.strip_prefix(|c: char| c.is_ascii_alphabetic()) {
        if let Some(tail) = rest.strip_prefix(":/") {
            let drive = s.chars().next().unwrap_or('c').to_ascii_lowercase();
            return format!("/{drive}/{tail}");
        }
    }
    s
}

// 各 CLI の設定ファイル位置。環境変数の指定を優先する（利用者がプロファイルを移していることがある）。
fn claude_settings_path() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("CLAUDE_CONFIG_DIR") {
        let d = dir.trim();
        if !d.is_empty() {
            return Some(PathBuf::from(d).join("settings.json"));
        }
    }
    Some(dirs::home_dir()?.join(".claude").join("settings.json"))
}

fn codex_config_path() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("CODEX_HOME") {
        let d = dir.trim();
        if !d.is_empty() {
            return Some(PathBuf::from(d).join("config.toml"));
        }
    }
    Some(dirs::home_dir()?.join(".codex").join("config.toml"))
}

// 書き換え前の退避。既に退避があっても上書きしない（最初の状態を残す）。
fn backup_once(path: &Path) -> Result<(), String> {
    if !path.is_file() {
        return Ok(());
    }
    let bak = path.with_extension(format!(
        "{}.ztkn-backup",
        path.extension().and_then(|s| s.to_str()).unwrap_or("")
    ));
    if bak.exists() {
        return Ok(());
    }
    std::fs::copy(path, &bak).map(|_| ()).map_err(|e| format!("退避に失敗: {e}"))
}

// ---- Claude Code (settings.json) ----

// ZTKN が入れたエントリか。command 文字列に ztkn-hook.exe を含むもの。
fn is_ztkn_entry(entry: &Value) -> bool {
    entry["hooks"]
        .as_array()
        .map(|hs| {
            hs.iter().any(|h| {
                h["command"]
                    .as_str()
                    .map(|c| c.to_ascii_lowercase().contains(HOOK_EXE_NAME))
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

fn claude_entry(exe: &Path, action: &str) -> Value {
    // Claude Code は Windows でも bash 経由で実行するため Git Bash 形式のパスを渡す。
    let p = to_git_bash_path(exe);
    json!({ "hooks": [{ "type": "command", "command": format!("bash -c '{p} {action}'") }] })
}

// settings.json に4イベント分を入れる。既存の ZTKN エントリは除去してから足す（冪等）。
// 他のフック・他の設定項目には触れない。
fn write_claude(exe: &Path, enable: bool) -> Result<(), String> {
    let path = claude_settings_path().ok_or("ホームディレクトリが特定できません")?;
    write_claude_at(&path, exe, enable)
}

// パスを引数に取る本体。テストで一時ディレクトリを渡せるように分けている。
fn write_claude_at(path: &Path, exe: &Path, enable: bool) -> Result<(), String> {
    if !enable && !path.is_file() {
        return Ok(()); // 無効化する対象がそもそも無い
    }
    let mut root: Value = if path.is_file() {
        let txt = std::fs::read_to_string(&path).map_err(|e| format!("読み込み失敗: {e}"))?;
        serde_json::from_str(&txt).map_err(|e| format!("settings.json が壊れています: {e}"))?
    } else {
        json!({})
    };
    if !root.is_object() {
        return Err("settings.json の形式が想定と違います".into());
    }
    backup_once(&path)?;

    let hooks = root
        .as_object_mut()
        .unwrap()
        .entry("hooks")
        .or_insert_with(|| json!({}));
    if !hooks.is_object() {
        return Err("settings.json の hooks が想定の形式ではありません".into());
    }
    for (event, action) in HOOK_EVENTS {
        let list = hooks
            .as_object_mut()
            .unwrap()
            .entry(event)
            .or_insert_with(|| json!([]));
        let arr = list.as_array_mut().ok_or("hooks の中身が配列ではありません")?;
        arr.retain(|e| !is_ztkn_entry(e)); // 旧ZTKNエントリを除去＝重複しない
        if enable {
            arr.push(claude_entry(exe, action));
        }
    }
    // 空になったイベントのキーは消す（元から無かった状態に戻す）
    if let Some(map) = hooks.as_object_mut() {
        map.retain(|_, v| !v.as_array().map(|a| a.is_empty()).unwrap_or(false));
    }
    let out = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    std::fs::write(path, out).map_err(|e| format!("書き込み失敗: {e}"))
}

fn claude_is_enabled() -> bool {
    let Some(path) = claude_settings_path() else { return false };
    let Ok(txt) = std::fs::read_to_string(&path) else { return false };
    let Ok(v) = serde_json::from_str::<Value>(&txt) else { return false };
    let Some(hooks) = v["hooks"].as_object() else { return false };
    // 4イベント全てに ZTKN エントリがあって初めて「有効」とみなす
    HOOK_EVENTS.iter().all(|(event, _)| {
        hooks
            .get(*event)
            .and_then(|l| l.as_array())
            .map(|a| a.iter().any(is_ztkn_entry))
            .unwrap_or(false)
    })
}

// ---- Codex CLI (config.toml) ----

// Codex は Windows で command_windows を使う（無い場合 WSL 経由になる）。
// command は非Windows向けのフォールバックなので Git Bash 形式で入れておく。
fn write_codex(exe: &Path, enable: bool) -> Result<(), String> {
    let path = codex_config_path().ok_or("ホームディレクトリが特定できません")?;
    write_codex_at(&path, exe, enable)
}

// パスを引数に取る本体。テストで一時ディレクトリを渡せるように分けている。
fn write_codex_at(path: &Path, exe: &Path, enable: bool) -> Result<(), String> {
    use toml_edit::{ArrayOfTables, DocumentMut, Item, Table};

    if !enable && !path.is_file() {
        return Ok(());
    }
    let txt = if path.is_file() {
        std::fs::read_to_string(&path).map_err(|e| format!("読み込み失敗: {e}"))?
    } else {
        String::new()
    };
    let mut doc: DocumentMut = txt
        .parse()
        .map_err(|e| format!("config.toml が壊れています: {e}"))?;
    backup_once(&path)?;

    let native = exe.to_string_lossy().to_string();
    let posix = to_git_bash_path(exe);

    // hooks テーブルが無ければ作る。既にあれば温存して中身だけ触る。
    if doc.get("hooks").is_none() {
        if !enable {
            return Ok(());
        }
        doc["hooks"] = Item::Table(Table::new());
    }
    let hooks = doc["hooks"]
        .as_table_mut()
        .ok_or("config.toml の hooks が想定の形式ではありません")?;

    for (event, action) in HOOK_EVENTS {
        // [[hooks.<Event>]] は配列テーブル。ZTKN 以外のエントリは残す。
        let mut kept = ArrayOfTables::new();
        if let Some(existing) = hooks.get(event).and_then(|i| i.as_array_of_tables()) {
            for t in existing.iter() {
                let is_ztkn = t
                    .get("hooks")
                    .and_then(|i| i.as_array_of_tables())
                    .map(|inner| {
                        inner.iter().any(|h| {
                            ["command", "command_windows"].iter().any(|k| {
                                h.get(*k)
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.to_ascii_lowercase().contains(HOOK_EXE_NAME))
                                    .unwrap_or(false)
                            })
                        })
                    })
                    .unwrap_or(false);
                if !is_ztkn {
                    kept.push(t.clone());
                }
            }
        }
        if enable {
            let mut inner = Table::new();
            inner["type"] = toml_edit::value("command");
            inner["command"] = toml_edit::value(format!("{posix} {action} codex"));
            inner["command_windows"] = toml_edit::value(format!("{native} {action} codex"));
            let mut inner_arr = ArrayOfTables::new();
            inner_arr.push(inner);
            let mut entry = Table::new();
            entry.insert("hooks", Item::ArrayOfTables(inner_arr));
            kept.push(entry);
        }
        if kept.is_empty() {
            hooks.remove(event);
        } else {
            hooks.insert(event, Item::ArrayOfTables(kept));
        }
    }
    if hooks.is_empty() {
        doc.remove("hooks");
    }
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    std::fs::write(path, doc.to_string()).map_err(|e| format!("書き込み失敗: {e}"))
}

fn codex_is_enabled() -> bool {
    let Some(path) = codex_config_path() else { return false };
    let Ok(txt) = std::fs::read_to_string(&path) else { return false };
    let Ok(doc) = txt.parse::<toml_edit::DocumentMut>() else { return false };
    let Some(hooks) = doc.get("hooks").and_then(|i| i.as_table()) else { return false };
    HOOK_EVENTS.iter().all(|(event, _)| {
        hooks
            .get(*event)
            .and_then(|i| i.as_array_of_tables())
            .map(|arr| {
                arr.iter().any(|t| {
                    t.get("hooks")
                        .and_then(|i| i.as_array_of_tables())
                        .map(|inner| {
                            inner.iter().any(|h| {
                                ["command", "command_windows"].iter().any(|k| {
                                    h.get(*k)
                                        .and_then(|v| v.as_str())
                                        .map(|s| s.to_ascii_lowercase().contains(HOOK_EXE_NAME))
                                        .unwrap_or(false)
                                })
                            })
                        })
                        .unwrap_or(false)
                })
            })
            .unwrap_or(false)
    })
}

// ---- 公開API ----

pub fn status() -> AiHookStatus {
    let dest = hook_exe_dest();
    AiHookStatus {
        claude_enabled: claude_is_enabled(),
        codex_enabled: codex_is_enabled(),
        claude_config: claude_settings_path().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
        codex_config: codex_config_path().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
        hook_exe: dest.to_string_lossy().to_string(),
        hook_exe_ready: dest.is_file(),
    }
}

// ztkn-hook.exe を ProgramData へ配置する（更新時も上書きして最新にする）。
fn install_hook_exe() -> Result<PathBuf, String> {
    let src = hook_exe_source().ok_or(
        "ztkn-hook.exe が見つかりません（開発時は `cargo build -p ztkn-hook` が必要です）",
    )?;
    let dest = hook_exe_dest();
    if let Some(dir) = dest.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("{} の作成に失敗: {e}", dir.display()))?;
    }
    // 実行中に上書きできないことがあるので、同一内容ならコピーを省く
    let same = std::fs::metadata(&src)
        .ok()
        .zip(std::fs::metadata(&dest).ok())
        .map(|(a, b)| a.len() == b.len())
        .unwrap_or(false);
    if !same {
        std::fs::copy(&src, &dest).map_err(|e| format!("{} へのコピーに失敗: {e}", dest.display()))?;
    }
    Ok(dest)
}

pub fn enable() -> Result<AiHookStatus, String> {
    let exe = install_hook_exe()?;
    // 前回の無効化中に取り残された状態があれば消してから始める。
    // 生きているセッションは次のフック発火で書き直されるので実害はない。
    clear_all_state();
    // 片方が失敗しても、もう片方は入れる。両方の結果をまとめて返す。
    let c = write_claude(&exe, true);
    let x = write_codex(&exe, true);
    match (c, x) {
        (Err(a), Err(b)) => Err(format!("Claude: {a} / Codex: {b}")),
        (Err(a), Ok(())) => Err(format!("Claude: {a}（Codex は設定しました）")),
        (Ok(()), Err(b)) => Err(format!("Codex: {b}（Claude は設定しました）")),
        (Ok(()), Ok(())) => Ok(status()),
    }
}

// 状態ファイルの置き場。フック(ztkn-hook)が書き、ZTKN が読む。
pub fn state_dir() -> Option<PathBuf> {
    Some(dirs::home_dir()?.join(".claude").join("ztkn-state"))
}

// 状態ファイルを全部消す。無効化したのに「実行中」が残り続けないようにするため。
// 無効化するとフックが動かなくなり Stop も飛ばないので、ここで消さないと
// セッションが終わるまで表示が残ってしまう。
pub fn clear_all_state() -> usize {
    let Some(dir) = state_dir() else { return 0 };
    let Ok(rd) = std::fs::read_dir(&dir) else { return 0 };
    let mut n = 0;
    for e in rd.flatten() {
        let p = e.path();
        if p.extension().and_then(|s| s.to_str()) == Some("json") && std::fs::remove_file(&p).is_ok() {
            n += 1;
        }
    }
    n
}

pub fn disable() -> Result<AiHookStatus, String> {
    let exe = hook_exe_dest();
    let c = write_claude(&exe, false);
    let x = write_codex(&exe, false);
    // 起動中の CLI が設定をキャッシュしていると、設定から消してもフックが呼ばれ続ける。
    // 実行ファイルごと消せば呼ばれても何も起きない（フック側はエラーでも CLI を止めない）。
    // 有効化し直す時に enable() が置き直すので、消して困ることはない。
    if exe.is_file() {
        if let Err(e) = std::fs::remove_file(&exe) {
            eprintln!("[aihooks] {} を消せませんでした: {e}", exe.display());
        }
    }
    // フックを外した以上、残った状態は更新されない。表示を即座に止めるため消す。
    let n = clear_all_state();
    if n > 0 {
        eprintln!("[aihooks] 状態ファイルを {n} 件削除しました");
    }
    match (c, x) {
        (Err(a), Err(b)) => Err(format!("Claude: {a} / Codex: {b}")),
        (Err(a), Ok(())) => Err(format!("Claude: {a}")),
        (Ok(()), Err(b)) => Err(format!("Codex: {b}")),
        (Ok(()), Ok(())) => Ok(status()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn git_bash_path_converts_drive_letter() {
        assert_eq!(
            to_git_bash_path(Path::new(r"C:\ProgramData\ZTKN\ztkn-hook.exe")),
            "/c/ProgramData/ZTKN/ztkn-hook.exe"
        );
        assert_eq!(
            to_git_bash_path(Path::new(r"D:\VSCode\app\ztkn-hook.exe")),
            "/d/VSCode/app/ztkn-hook.exe"
        );
    }

    #[test]
    fn claude_entry_has_expected_shape() {
        let e = claude_entry(Path::new(r"C:\ProgramData\ZTKN\ztkn-hook.exe"), "wait");
        let cmd = e["hooks"][0]["command"].as_str().unwrap();
        assert_eq!(cmd, "bash -c '/c/ProgramData/ZTKN/ztkn-hook.exe wait'");
        assert_eq!(e["hooks"][0]["type"].as_str().unwrap(), "command");
    }

    #[test]
    fn ztkn_entry_is_detected_by_exe_name() {
        let mine = claude_entry(Path::new(r"C:\ProgramData\ZTKN\ztkn-hook.exe"), "running");
        assert!(is_ztkn_entry(&mine));
        let other = json!({ "hooks": [{ "type": "command", "command": "bash -c 'echo hi'" }] });
        assert!(!is_ztkn_entry(&other));
    }

    // 既存フックを壊さないことの確認（このプロジェクトで最も壊してはいけない性質）
    #[test]
    fn claude_merge_keeps_foreign_hooks() {
        let mut root = json!({
            "model": "opus",
            "hooks": {
                "PostToolUse": [
                    { "hooks": [{ "type": "command", "command": "bash -c 'security-check'" }] }
                ],
                "PreToolUse": [
                    { "matcher": "Write", "hooks": [{ "type": "command", "command": "bash -c 'lint'" }] }
                ]
            }
        });
        // write_claude の中核と同じ手順を再現（ファイルI/Oを挟まず検証する）
        let exe = Path::new(r"C:\ProgramData\ZTKN\ztkn-hook.exe");
        let hooks = root.as_object_mut().unwrap().get_mut("hooks").unwrap();
        for (event, action) in HOOK_EVENTS {
            let list = hooks.as_object_mut().unwrap().entry(event).or_insert_with(|| json!([]));
            let arr = list.as_array_mut().unwrap();
            arr.retain(|e| !is_ztkn_entry(e));
            arr.push(claude_entry(exe, action));
        }
        // 他人のフックが残っていること
        let post = root["hooks"]["PostToolUse"].as_array().unwrap();
        assert!(post.iter().any(|e| e["hooks"][0]["command"]
            .as_str()
            .unwrap()
            .contains("security-check")));
        // PreToolUse(ZTKNが使わないイベント)は素通し
        assert_eq!(root["hooks"]["PreToolUse"].as_array().unwrap().len(), 1);
        // 他の設定項目も無傷
        assert_eq!(root["model"].as_str().unwrap(), "opus");
        // ZTKN分が4イベントに入っていること
        for (event, _) in HOOK_EVENTS {
            assert!(root["hooks"][event].as_array().unwrap().iter().any(is_ztkn_entry), "{event}");
        }
    }

    // 一時ディレクトリを作る（外部クレートを足さずに済ませる）
    fn temp_dir(tag: &str) -> PathBuf {
        let mut d = std::env::temp_dir();
        d.push(format!("ztkn-aihooks-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    // 実ファイルに対する往復。enable を2回 → disable して、
    // 他人のフックと他の設定が最初の状態に戻ることを確認する。
    #[test]
    fn claude_file_roundtrip_preserves_everything() {
        let dir = temp_dir("claude");
        let path = dir.join("settings.json");
        let original = json!({
            "model": "opus",
            "permissions": { "allow": ["Bash(ls:*)"] },
            "hooks": {
                "PreToolUse": [
                    { "matcher": "Write|Edit", "hooks": [{ "type": "command", "command": "bash -c 'secret-scan'" }] }
                ],
                "PostToolUse": [
                    { "hooks": [{ "type": "command", "command": "bash -c 'notify'" }] }
                ],
                "Stop": [
                    { "hooks": [{ "type": "command", "command": "bash -c 'cleanup'" }] }
                ]
            }
        });
        std::fs::write(&path, serde_json::to_string_pretty(&original).unwrap()).unwrap();
        let exe = Path::new(r"C:\ProgramData\ZTKN\ztkn-hook.exe");

        // 2回入れても重複しない
        write_claude_at(&path, exe, true).unwrap();
        write_claude_at(&path, exe, true).unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        for (event, _) in HOOK_EVENTS {
            let n = v["hooks"][event].as_array().unwrap().iter().filter(|e| is_ztkn_entry(e)).count();
            assert_eq!(n, 1, "{event} のZTKNエントリが{n}件");
        }
        // 他人のフックが健在
        assert_eq!(v["hooks"]["PreToolUse"].as_array().unwrap().len(), 1);
        assert!(v["hooks"]["PostToolUse"].as_array().unwrap().iter()
            .any(|e| e["hooks"][0]["command"].as_str().unwrap().contains("notify")));
        assert!(v["hooks"]["Stop"].as_array().unwrap().iter()
            .any(|e| e["hooks"][0]["command"].as_str().unwrap().contains("cleanup")));
        assert_eq!(v["model"].as_str().unwrap(), "opus");
        assert_eq!(v["permissions"]["allow"][0].as_str().unwrap(), "Bash(ls:*)");
        // 退避が作られている
        assert!(dir.join("settings.json.ztkn-backup").is_file());

        // 外して元通りになる
        write_claude_at(&path, exe, false).unwrap();
        let v2: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(v2["hooks"], original["hooks"], "disable後に元のhooksへ戻っていない");
        assert_eq!(v2["model"], original["model"]);

        let _ = std::fs::remove_dir_all(&dir);
    }

    // Codex 側も同様。手書きのコメントと他設定が残ることを見る。
    #[test]
    fn codex_file_roundtrip_preserves_comments_and_other_settings() {
        let dir = temp_dir("codex");
        let path = dir.join("config.toml");
        let original = r#"# 利用者が手で書いた設定
model = "gpt-5.6-sol"
approval_policy = "on-request"

[[hooks.PreToolUse]]
[[hooks.PreToolUse.hooks]]
type = "command"
command = "my-own-hook"
"#;
        std::fs::write(&path, original).unwrap();
        let exe = Path::new(r"C:\ProgramData\ZTKN\ztkn-hook.exe");

        write_codex_at(&path, exe, true).unwrap();
        write_codex_at(&path, exe, true).unwrap();
        let txt = std::fs::read_to_string(&path).unwrap();
        // ZTKN分が4イベント、各1件
        for (event, action) in HOOK_EVENTS {
            let n = txt.matches(&format!("{action} codex")).count();
            assert!(n >= 1, "{event}({action}) が入っていない");
        }
        assert_eq!(txt.matches("ztkn-hook.exe running codex").count(), 4, "running が重複/不足"); // posix+windows × 2イベント
        // 手書きの内容が残っている
        assert!(txt.contains("# 利用者が手で書いた設定"), "コメントが消えた");
        assert!(txt.contains("gpt-5.6-sol"), "他の設定が消えた");
        assert!(txt.contains("my-own-hook"), "既存フックが消えた");

        write_codex_at(&path, exe, false).unwrap();
        let txt2 = std::fs::read_to_string(&path).unwrap();
        assert!(!txt2.contains("ztkn-hook"), "disable後もZTKNが残っている");
        assert!(txt2.contains("my-own-hook"), "disableで既存フックまで消えた");
        assert!(txt2.contains("# 利用者が手で書いた設定"), "disableでコメントが消えた");

        let _ = std::fs::remove_dir_all(&dir);
    }

    // 実機の設定ファイル（コピー）で往復させる。合成データでは再現しない複雑さ
    // （既存フックが多数・手書きコメント・独自キー）に対して壊さないことを確認する。
    // 本物のファイルには触れない。実行: cargo test --lib real_config -- --ignored
    #[test]
    #[ignore = "実機の ~/.claude と ~/.codex が必要"]
    fn real_config_roundtrip_preserves_everything() {
        let Some(home) = dirs::home_dir() else { return };
        let real_claude = home.join(".claude").join("settings.json");
        let real_codex = home.join(".codex").join("config.toml");
        if !real_claude.is_file() || !real_codex.is_file() {
            eprintln!("実設定が無いのでスキップ");
            return;
        }
        let dir = temp_dir("real");
        let cp = dir.join("settings.json");
        let xp = dir.join("config.toml");
        std::fs::copy(&real_claude, &cp).unwrap();
        std::fs::copy(&real_codex, &xp).unwrap();

        // ZTKN 以外のエントリを取り出す（比較の基準）
        let foreign_of = |p: &Path| -> Vec<String> {
            let v: Value = serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap();
            let mut out = vec![];
            if let Some(h) = v["hooks"].as_object() {
                for (ev, list) in h {
                    for e in list.as_array().into_iter().flatten() {
                        if !is_ztkn_entry(e) {
                            out.push(format!("{ev}:{e}"));
                        }
                    }
                }
            }
            out.sort();
            out
        };
        // toml_edit の Debug は空白位置(decor)や doc_position を含み、
        // 別の箇所を編集しただけでも変化する。値だけを取り出して比較する。
        fn norm(item: &toml_edit::Item, out: &mut Vec<String>, path: &str) {
            match item {
                toml_edit::Item::Value(v) => out.push(format!("{path}={}", v.to_string().trim())),
                toml_edit::Item::Table(t) => {
                    for (k, v) in t.iter() {
                        norm(v, out, &format!("{path}.{k}"));
                    }
                }
                toml_edit::Item::ArrayOfTables(a) => {
                    for (i, t) in a.iter().enumerate() {
                        for (k, v) in t.iter() {
                            norm(v, out, &format!("{path}[{i}].{k}"));
                        }
                    }
                }
                toml_edit::Item::None => {}
            }
        }

        // 行単位だと ZTKN ブロックの構成行（[[hooks.X]] や type=）まで拾ってしまうので、
        // TOML として解析し「hooks 以外の全設定」と「hooks 配下の ZTKN 以外」を比べる。
        let codex_foreign_of = |p: &Path| -> Vec<String> {
            let doc = std::fs::read_to_string(p).unwrap().parse::<toml_edit::DocumentMut>().unwrap();
            let mut out = vec![];
            for (k, v) in doc.iter() {
                if k != "hooks" {
                    norm(v, &mut out, k); // hooks以外のトップレベル設定
                }
            }
            if let Some(h) = doc.get("hooks").and_then(|i| i.as_table()) {
                for (ev, item) in h.iter() {
                    match item.as_array_of_tables() {
                        // イベント配列は ZTKN 以外のエントリだけ拾う。
                        // Table::to_string() は入れ子の [[hooks.X.hooks]] を含まないので、
                        // 本番コードと同じく内側の command を見て判定する。
                        Some(arr) => {
                            for t in arr.iter() {
                                let is_ztkn = t
                                    .get("hooks")
                                    .and_then(|i| i.as_array_of_tables())
                                    .map(|inner| {
                                        inner.iter().any(|hh| {
                                            ["command", "command_windows"].iter().any(|k| {
                                                hh.get(*k)
                                                    .and_then(|v| v.as_str())
                                                    .map(|s| s.to_ascii_lowercase().contains(HOOK_EXE_NAME))
                                                    .unwrap_or(false)
                                            })
                                        })
                                    })
                                    .unwrap_or(false);
                                if !is_ztkn {
                                    let mut sub = vec![];
                                    for (k, v) in t.iter() {
                                        norm(v, &mut sub, k);
                                    }
                                    sub.sort();
                                    out.push(format!("hooks.{ev}[]={}", sub.join(",")));
                                }
                            }
                        }
                        // [hooks.state] のような非配列テーブルは丸ごと保持されるべき
                        None => norm(item, &mut out, &format!("hooks.{ev}")),
                    }
                }
            }
            out.sort();
            out
        };

        let before_c = foreign_of(&cp);
        let before_x = codex_foreign_of(&xp);
        eprintln!("実設定: 他人のClaudeフック {} 件 / Codex {} 行", before_c.len(), before_x.len());
        assert!(!before_c.is_empty(), "検証にならないので他人のフックがある前提");

        let exe = Path::new(r"C:\ProgramData\ZTKN\ztkn-hook.exe");
        write_claude_at(&cp, exe, true).unwrap();
        write_claude_at(&cp, exe, true).unwrap();
        write_codex_at(&xp, exe, true).unwrap();
        write_codex_at(&xp, exe, true).unwrap();

        assert_eq!(foreign_of(&cp), before_c, "enableで他人のClaudeフックが変化した");
        for (event, _) in HOOK_EVENTS {
            let v: Value = serde_json::from_str(&std::fs::read_to_string(&cp).unwrap()).unwrap();
            let n = v["hooks"][event].as_array().unwrap().iter().filter(|e| is_ztkn_entry(e)).count();
            assert_eq!(n, 1, "{event} が {n} 件");
        }

        write_claude_at(&cp, exe, false).unwrap();
        write_codex_at(&xp, exe, false).unwrap();
        assert_eq!(foreign_of(&cp), before_c, "disableで他人のClaudeフックが変化した");
        let after_x = codex_foreign_of(&xp);
        if after_x != before_x {
            // 差分は巨大になるのでキー名（= の左側）だけ出す
            let key_of = |s: &String| s.split('=').next().unwrap_or("").to_string();
            let bk: Vec<String> = before_x.iter().map(key_of).collect();
            let ak: Vec<String> = after_x.iter().map(key_of).collect();
            for k in &bk {
                if !ak.contains(k) {
                    eprintln!("  消えた: {k}");
                }
            }
            for k in &ak {
                if !bk.contains(k) {
                    eprintln!("  増えた: {k}");
                }
            }
            for (b, a) in before_x.iter().zip(after_x.iter()) {
                if b != a {
                    eprintln!("  中身が変化: {}", key_of(b));
                }
            }
        }
        assert_eq!(after_x, before_x, "disableでCodexの他の行が変化した");

        // 本物が無傷であること
        let orig: Value = serde_json::from_str(&std::fs::read_to_string(&real_claude).unwrap()).unwrap();
        assert!(orig["hooks"].is_object(), "本物のsettings.jsonが読めない＝壊した可能性");

        let _ = std::fs::remove_dir_all(&dir);
    }

    // 無効化したら状態ファイルが残らないこと（残ると「実行中」が表示されっぱなしになる）
    #[test]
    fn clear_all_state_removes_only_json() {
        let dir = temp_dir("state");
        std::fs::write(dir.join("a.json"), "{}").unwrap();
        std::fs::write(dir.join("b.json"), "{}").unwrap();
        std::fs::write(dir.join("keep.txt"), "x").unwrap();

        // clear_all_state はホーム配下を見るので、ここでは同じ処理を再現して検証する
        let mut n = 0;
        for e in std::fs::read_dir(&dir).unwrap().flatten() {
            let p = e.path();
            if p.extension().and_then(|s| s.to_str()) == Some("json") && std::fs::remove_file(&p).is_ok() {
                n += 1;
            }
        }
        assert_eq!(n, 2);
        assert!(!dir.join("a.json").exists());
        assert!(!dir.join("b.json").exists());
        assert!(dir.join("keep.txt").exists(), "json以外まで消してはいけない");

        let _ = std::fs::remove_dir_all(&dir);
    }

    // 二度入れても重複しないこと
    #[test]
    fn claude_merge_is_idempotent() {
        let exe = Path::new(r"C:\ProgramData\ZTKN\ztkn-hook.exe");
        let mut arr = json!([]);
        let a = arr.as_array_mut().unwrap();
        for _ in 0..3 {
            a.retain(|e| !is_ztkn_entry(e));
            a.push(claude_entry(exe, "running"));
        }
        assert_eq!(a.len(), 1);
    }
}
