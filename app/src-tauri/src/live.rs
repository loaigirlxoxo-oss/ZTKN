//! Latest-value store for the live data the page shows (sensors, AI usage,
//! agent alerts). The page pulls it with `get_live` instead of being pushed
//! Tauri events.
//!
//! Why: Tauri events are delivered by evaluating JavaScript in the webview,
//! and that leaks inside WebView2's renderer (tauri-apps/tauri#12724). The
//! sensors payload is ~33 KB twice a second, and the renderer's native heap
//! grew ~3 MB/min in doubling steps until it was killed for OOM after
//! 7-9 hours. Only the newest value matters, so it is overwritten, never queued.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use serde::Serialize;

fn store() -> &'static Mutex<HashMap<&'static str, (u64, String)>> {
    static S: OnceLock<Mutex<HashMap<&'static str, (u64, String)>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Replace the latest value for `key` and bump its sequence number.
pub fn publish(key: &'static str, value: String) {
    if let Ok(mut m) = store().lock() {
        let seq = m.get(key).map(|(s, _)| s + 1).unwrap_or(1);
        m.insert(key, (seq, value));
    }
}

#[derive(Serialize, Debug, PartialEq)]
pub struct LiveItem {
    pub key: String,
    pub seq: u64,
    pub value: String,
}

/// Entries whose sequence differs from what the caller already has.
fn changed_since(known: &HashMap<String, u64>) -> Vec<LiveItem> {
    let Ok(m) = store().lock() else { return Vec::new() };
    m.iter()
        .filter(|(k, (seq, _))| known.get(**k) != Some(seq))
        .map(|(k, (seq, v))| LiveItem { key: (*k).to_string(), seq: *seq, value: v.clone() })
        .collect()
}

#[tauri::command]
pub fn get_live(known: HashMap<String, u64>) -> Vec<LiveItem> {
    changed_since(&known)
}

#[cfg(test)]
mod tests {
    use super::*;

    // 変わったものだけ返す。同じ seq を渡せば空、値が更新されれば再び返る。
    #[test]
    fn returns_only_changed_entries() {
        publish("test-a", "1".into());
        publish("test-b", "x".into());
        let first = changed_since(&HashMap::new());
        let a = first.iter().find(|i| i.key == "test-a").unwrap();
        let b = first.iter().find(|i| i.key == "test-b").unwrap();
        let known: HashMap<String, u64> =
            [("test-a".to_string(), a.seq), ("test-b".to_string(), b.seq)].into();
        assert!(changed_since(&known).iter().all(|i| i.key != "test-a" && i.key != "test-b"));
        publish("test-a", "2".into());
        let again = changed_since(&known);
        let a2 = again.iter().find(|i| i.key == "test-a").unwrap();
        assert_eq!(a2.value, "2");
        assert!(again.iter().all(|i| i.key != "test-b"));
    }
}
