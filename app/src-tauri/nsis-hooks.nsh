; ZTKN PawnIO 版インストーラのフック。
; インストール完了後、同梱の PawnIO ドライバをサイレント導入する。
; PawnIO は Memory Integrity(HVCI) 対応の署名済み ring0 ドライバで、
; CPU/マザボ温度の読み取りに必要（WinRing0 の代替）。
; アンインストール時は PawnIO を残す（他アプリが利用している可能性があるため）。

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "PawnIO ドライバを導入中 (CPU/マザボ温度センサー用)..."
  ExecWait '"$INSTDIR\PawnIO_setup.exe" -install -silent'
!macroend
