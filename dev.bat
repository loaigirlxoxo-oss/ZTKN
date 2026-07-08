@echo off
title ZTKN dev
cd /d "%~dp0"
echo Launching ZTKN in developer mode (elevated).
echo Approve the UAC prompt when it appears...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\dev-admin.ps1"
