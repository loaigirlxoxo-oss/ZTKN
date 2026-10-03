//! Memory of the page's renderer process (WebView2).
//!
//! The renderer still grows slowly (~4 MB/hour after moving live data off
//! Tauri events; see live.rs). Reloading the page releases it (measured: 113 MB
//! -> 86 MB in the same renderer process), so the page asks for this number
//! and reloads itself when it gets too large.
//!
//! Process tree: this app -> msedgewebview2 (browser) -> renderer / gpu /
//! utility. Only processes started with `--type=renderer` are counted: the GPU
//! process is often the largest grandchild (measured 174 MB vs. renderer 83 MB)
//! and a reload does not shrink it, so counting it would reset in a loop.

#[cfg(windows)]
fn private_bytes(pid: u32) -> Option<u64> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS_EX};
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() {
            return None;
        }
        let mut c: PROCESS_MEMORY_COUNTERS_EX = std::mem::zeroed();
        c.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32;
        let ok = GetProcessMemoryInfo(h, &mut c as *mut _ as *mut _, c.cb);
        CloseHandle(h);
        (ok != 0).then_some(c.PrivateUsage as u64)
    }
}

/// Command line of another process (Windows 8.1+, needs only limited query rights).
#[cfg(windows)]
fn command_line(pid: u32) -> Option<String> {
    use windows_sys::Wdk::System::Threading::{NtQueryInformationProcess, ProcessCommandLineInformation};
    use windows_sys::Win32::Foundation::{CloseHandle, UNICODE_STRING};
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() {
            return None;
        }
        let mut need = 0u32;
        NtQueryInformationProcess(h, ProcessCommandLineInformation, std::ptr::null_mut(), 0, &mut need);
        let mut out = None;
        if need as usize >= std::mem::size_of::<UNICODE_STRING>() {
            // u64 で確保して UNICODE_STRING の配置に合わせる。Buffer は同じ領域の中を指す。
            let mut buf = vec![0u64; (need as usize).div_ceil(8)];
            let st = NtQueryInformationProcess(h, ProcessCommandLineInformation, buf.as_mut_ptr().cast(), need, &mut need);
            if st >= 0 {
                let us = &*(buf.as_ptr() as *const UNICODE_STRING);
                if !us.Buffer.is_null() {
                    let s = std::slice::from_raw_parts(us.Buffer, us.Length as usize / 2);
                    out = Some(String::from_utf16_lossy(s));
                }
            }
        }
        CloseHandle(h);
        out
    }
}

/// (pid, parent pid, exe name) of every process.
#[cfg(windows)]
fn processes() -> Vec<(u32, u32, String)> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    let mut out = Vec::new();
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return out;
        }
        let mut e: PROCESSENTRY32W = std::mem::zeroed();
        e.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        if Process32FirstW(snap, &mut e) != 0 {
            loop {
                let len = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(e.szExeFile.len());
                out.push((e.th32ProcessID, e.th32ParentProcessID, String::from_utf16_lossy(&e.szExeFile[..len])));
                if Process32NextW(snap, &mut e) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snap);
    }
    out
}

/// Largest renderer among the WebView2 grandchildren of `root`, in MB.
fn renderer_mb(
    root: u32,
    procs: &[(u32, u32, String)],
    is_renderer: impl Fn(u32) -> bool,
    mem: impl Fn(u32) -> Option<u64>,
) -> Option<u64> {
    let is_wv = |n: &str| n.eq_ignore_ascii_case("msedgewebview2.exe");
    let browsers: Vec<u32> = procs.iter().filter(|(_, pp, n)| *pp == root && is_wv(n)).map(|(p, _, _)| *p).collect();
    procs
        .iter()
        .filter(|(p, pp, n)| browsers.contains(pp) && is_wv(n) && is_renderer(*p))
        .filter_map(|(p, _, _)| mem(*p))
        .max()
        .map(|b| b / (1024 * 1024))
}

/// Renderer memory in MB, or `None` when it cannot be measured.
#[tauri::command]
pub fn renderer_memory_mb() -> Option<u64> {
    #[cfg(windows)]
    {
        let is_renderer = |pid| command_line(pid).is_some_and(|c| c.contains("--type=renderer"));
        renderer_mb(std::process::id(), &processes(), is_renderer, private_bytes)
    }
    #[cfg(not(windows))]
    {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // 自分の孫の WebView のうち renderer だけを数え、その最大を返す。
    // GPU プロセスやほかのアプリの WebView は、大きくても数えない。
    #[test]
    fn counts_only_own_renderers() {
        let wv = "msedgewebview2.exe".to_string();
        let procs = vec![
            (100, 1, "app.exe".into()),
            (200, 100, wv.clone()),  // browser
            (201, 200, wv.clone()),  // gpu
            (202, 200, wv.clone()),  // renderer
            (300, 9, wv.clone()),    // 他アプリの browser
            (301, 300, wv.clone()),  // 他アプリの renderer（巨大）
        ];
        let mem = |p: u32| Some(match p { 201 => 900, 202 => 300, 301 => 5000, _ => 10 } * 1024 * 1024);
        let renderer = |p: u32| p == 202 || p == 301;  // 201 は GPU（いちばん大きい）
        assert_eq!(renderer_mb(100, &procs, renderer, mem), Some(300));
        assert_eq!(renderer_mb(999, &procs, renderer, mem), None);
    }
}
