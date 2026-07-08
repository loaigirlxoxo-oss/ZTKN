@echo off
setlocal EnableExtensions
title ZTKN release build
cd /d "%~dp0"

echo ============================================
echo   ZTKN release build
echo ============================================
echo.

REM --- toolchain PATH (cargo / system Node; Volta is unreliable) ---
set "PATH=%USERPROFILE%\.cargo\bin;C:\Program Files\nodejs;%PATH%"

where cargo >nul 2>nul
if errorlevel 1 (
  echo [ERROR] cargo not found. Install Rust via rustup.
  goto :fail
)
where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm not found. Install Node.js.
  goto :fail
)

REM --- .NET sidecar: build if missing. Force rebuild: build.bat sidecar ---
set "SIDECAR=app\src-tauri\binaries\sensor-sidecar-x86_64-pc-windows-msvc.exe"
if /I "%~1"=="sidecar" goto :buildsidecar
if exist "%SIDECAR%" (
  echo [1/4] sidecar exists  ^(force rebuild: build.bat sidecar^)
  goto :aftersidecar
)
:buildsidecar
echo [1/4] building sensor sidecar ^(.NET^) ...
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\build-sidecar.ps1"
if errorlevel 1 goto :fail
:aftersidecar

REM --- bundled PawnIO installer (required by the release installer) ---
if not exist "app\src-tauri\installer-deps\PawnIO_setup.exe" goto :nopawnio
echo [2/4] PawnIO installer present

REM --- frontend deps ---
if exist "app\node_modules" (
  echo [3/4] node_modules present
  goto :afterinstall
)
echo [3/4] npm install ...
pushd app
call npm install
if errorlevel 1 (
  popd
  goto :fail
)
popd
:afterinstall

REM --- build the NSIS installer ---
echo [4/4] tauri build ...
pushd app
call npm run tauri build
if errorlevel 1 (
  popd
  goto :fail
)
popd

echo.
echo === done. installer(s): ===
dir /b "app\src-tauri\target\release\bundle\nsis\*.exe" 2>nul
echo location: app\src-tauri\target\release\bundle\nsis\
echo Note: distribute via GitHub Releases assets and include the SHA-256.
echo.
pause
exit /b 0

:nopawnio
echo [ERROR] app\src-tauri\installer-deps\PawnIO_setup.exe is missing.
echo         Get it from https://github.com/namazso/PawnIO.Setup/releases and place it there.
goto :fail

:fail
echo.
echo *** BUILD FAILED ***
pause
exit /b 1
