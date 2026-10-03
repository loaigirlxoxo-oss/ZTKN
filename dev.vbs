' Launch ZTKN in developer mode without showing any console window.
' Double-click this file and approve the UAC prompt; only the ZTKN window appears.
'
' Why a .vbs: a .bat always opens a console, and an elevated PowerShell opens its own
' (blue) window. wscript has no console, and ShellExecute "runas" with window style 0
' starts the elevated PowerShell hidden. Output goes to %TEMP%\ztkn-dev.log.
Dim fso, root
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("Shell.Application").ShellExecute "powershell.exe", _
    "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & root & "\tools\dev-admin.ps1""", _
    root, "runas", 0
