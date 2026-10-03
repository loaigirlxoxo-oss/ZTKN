@echo off
rem Kept for compatibility. dev.vbs starts ZTKN dev with no console window;
rem a .bat cannot avoid showing this one for a moment.
start "" wscript.exe "%~dp0dev.vbs"
