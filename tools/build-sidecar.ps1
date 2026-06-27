# センサーサイドカー(.NET)を発行し、Tauri の binaries へ配置する。
# 使い方: PowerShell で `tools\build-sidecar.ps1` を実行（.NET 9 SDK 必須）。
# binaries の .exe は .gitignore 済みのため、クローン後はこのスクリプトで生成する。

$ErrorActionPreference = "Stop"
$proj = Join-Path $PSScriptRoot "sensor-sidecar"
$dest = Join-Path $PSScriptRoot "..\app\src-tauri\binaries"
$triple = "x86_64-pc-windows-msvc"   # Tauri sidecar 命名規約

dotnet publish $proj -c Release -r win-x64 --self-contained false -p:PublishSingleFile=true -o (Join-Path $proj "publish")
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item (Join-Path $proj "publish\sensor-sidecar.exe") (Join-Path $dest "sensor-sidecar-$triple.exe") -Force
Write-Output "placed: $dest\sensor-sidecar-$triple.exe"
