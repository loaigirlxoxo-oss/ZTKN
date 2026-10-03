# Run `tauri dev` as Administrator. The app is requireAdministrator (needed to read
# CPU/motherboard temperatures, voltages, fans via the kernel driver), so dev must be elevated too.
# If launched non-elevated, this script self-elevates and relaunches.
#
# Everything runs without a visible window (launched hidden by dev.vbs): only the ZTKN
# window should appear. Output is written to $log, and a failed start shows a message box,
# because otherwise a failure would be invisible.
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Start-Process powershell -Verb RunAs -WindowStyle Hidden -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", "`"$PSCommandPath`""
    exit
}

$log = Join-Path $env:TEMP "ztkn-dev.log"

# Prefer system Node (Volta here is half-broken) and put cargo on PATH.
$env:Path = "C:\Program Files\nodejs;$env:USERPROFILE\.cargo\bin;" + $env:Path

# Clean up leftover processes (this elevated session can stop the elevated app too).
Get-Process app -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like '*sensor-sidecar*' } | Stop-Process -Force -ErrorAction SilentlyContinue
$conn = Get-NetTCPConnection -LocalPort 1420 -State Listen -ErrorAction SilentlyContinue
if ($conn) { $conn.OwningProcess | Sort-Object -Unique | ForEach-Object { try { Stop-Process -Id $_ -Force } catch {} } }

Set-Location (Join-Path $PSScriptRoot "..\app")
# cmd does the redirection: PowerShell 5.1 would wrap npm's stderr lines in error records.
cmd /c "npm run tauri dev > `"$log`" 2>&1"
if ($LASTEXITCODE -ne 0) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show("ZTKN dev exited with code $LASTEXITCODE.`nLog: $log", "ZTKN dev") | Out-Null
}
