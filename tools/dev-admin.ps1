# アプリは requireAdministrator（CPU温度等の取得に昇格が必要）なので dev も管理者で動かす。
# 非管理者で実行された場合は自分を昇格して再起動する。
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Start-Process powershell -Verb RunAs -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`""
    exit
}

# Volta の半壊状態を避けるためシステム Node を優先、cargo も PATH へ
$env:Path = "C:\Program Files\nodejs;$env:USERPROFILE\.cargo\bin;" + $env:Path

# 残プロセス掃除（昇格セッションなので昇格 app も止められる）
Get-Process app -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like '*sensor-sidecar*' } | Stop-Process -Force -ErrorAction SilentlyContinue
$conn = Get-NetTCPConnection -LocalPort 1420 -State Listen -ErrorAction SilentlyContinue
if ($conn) { $conn.OwningProcess | Sort-Object -Unique | ForEach-Object { try { Stop-Process -Id $_ -Force } catch {} } }

Set-Location (Join-Path $PSScriptRoot "..\app")
npm run tauri dev
