# センサーサイドカー(.NET)を発行し、Tauri の binaries へ配置する。
# 使い方: PowerShell で `tools\build-sidecar.ps1` を実行（.NET 9 SDK 必須）。
# binaries の .exe は .gitignore 済みのため、クローン後はこのスクリプトで生成する。
#
# self-contained=true：.NET 9 ランタイムを同梱した単一exeを作る。配布先に .NET が
# 無くても動く（配布に必須）。※trim は LibreHardwareMonitorLib の reflection/native を
# 壊す恐れがあるため使わない（サイズは増えるが確実性を優先）。

$ErrorActionPreference = "Stop"
$proj = Join-Path $PSScriptRoot "sensor-sidecar"
$dest = Join-Path $PSScriptRoot "..\app\src-tauri\binaries"
$triple = "x86_64-pc-windows-msvc"   # Tauri sidecar 命名規約

dotnet publish $proj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o (Join-Path $proj "publish")
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item (Join-Path $proj "publish\sensor-sidecar.exe") (Join-Path $dest "sensor-sidecar-$triple.exe") -Force
Write-Output "placed: $dest\sensor-sidecar-$triple.exe"
