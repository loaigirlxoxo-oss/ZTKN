# Run `tauri dev` as Administrator. The app is requireAdministrator (needed to read
# CPU/motherboard temperatures, voltages, fans via the kernel driver), so dev must be elevated too.
# If launched non-elevated, this script self-elevates and relaunches.
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Start-Process powershell -Verb RunAs -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`""
    exit
}

# Prefer system Node (Volta here is half-broken) and put cargo on PATH.
$env:Path = "C:\Program Files\nodejs;$env:USERPROFILE\.cargo\bin;" + $env:Path

# Clean up leftover processes (this elevated session can stop the elevated app too).
Get-Process app -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like '*sensor-sidecar*' } | Stop-Process -Force -ErrorAction SilentlyContinue
$conn = Get-NetTCPConnection -LocalPort 1420 -State Listen -ErrorAction SilentlyContinue
if ($conn) { $conn.OwningProcess | Sort-Object -Unique | ForEach-Object { try { Stop-Process -Id $_ -Force } catch {} } }

Set-Location (Join-Path $PSScriptRoot "..\app")
npm run tauri dev
