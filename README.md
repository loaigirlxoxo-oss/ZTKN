# ZTKN

AIDA64 SensorPanel 風の、**サブモニタ常駐 PC ステータスダッシュボード**。
アプリ内エディタで、センサー値・ゲージ・グラフ・画像を自由に配置してオリジナルの
モニターパネルを作り、サブモニタへフルスクリーン常駐表示できます。

- **プレイヤー兼エディタ**: アプリ内で項目追加・ドラッグ配置・色/フォント編集まで完結
- **実センサー**: CPU / GPU / メモリ / ネットワーク / ストレージ の温度・負荷・クロック・電力等
- **機種非依存**: 別 PC でもセンサーを自動照合（型番が違っても同種センサーに合わせる）

技術: Tauri (Rust) + SvelteKit + TypeScript + Konva.js。
センサーは .NET サイドカー（LibreHardwareMonitorLib 0.9.7-pre + **PawnIO**）で取得。

---

## 動作環境

- Windows 10 / 11 (x64)
- **管理者権限**（CPU / マザボ温度・電圧・ファンをカーネルドライバ経由で読むため。起動時に UAC が出ます）
- 温度読取に **PawnIO**（署名済み・Memory Integrity 対応の ring0 ドライバ）を使用。**インストーラが自動導入**するため、
  Windows のコア分離（メモリ整合性）を無効化する必要はありません。

## インストール

1. [Releases](../../releases) から `ZTKN_x.x.x_x64-setup.exe` をダウンロードして実行
2. 途中で PawnIO ドライバが自動でサイレント導入されます
3. 起動（UAC を承認）

## 使い方

- 起動するとエディタが開きます。左のパレットから部品を追加し、ドラッグで配置、右のプロパティで編集します。
- **部品**: ラベル / センサー値 / 丸ゲージ / 棒ゲージ / 折れ線グラフ / 画像 / 日時 / 枠線・区切り線
- **センサー割当**: 部品を選び、プロパティの「センサー」から割当（検索可）。合算値（例: CPU+GPU の Total Power）も選べます。
- **テンプレ/プリセット**: ツールバーの「読込」から内蔵テンプレや保存済みパネルを読み込み。
- **素材**: アプリの `Assets/`（背景・連番ゲージ・枠）と `image/`（1枚絵）にファイルを入れて「更新」。パックはフォルダ構成から自動分類。
- **表示（常駐）**: 「▶ 表示」でフルスクリーン表示（Esc またはダブルクリックで戻る）。表示モニタは選択可能。
- **常駐/自動起動**: ウィンドウの × はトレイ格納（終了はトレイメニュー）。「自動起動」で OS ログイン時にトレイ常駐で開始。
- **編集操作**: 複数選択（Shift / ラバーバンド）、整列・等間隔、PowerPoint 風スマートガイド、左右/上下反転、回転、Undo/Redo (Ctrl+Z / Y)。

保存パネルは実行ファイルの隣の `Panels/` に、素材は `Assets/` / `image/` に置かれます（ユーザーコンテンツ）。

---

## ソースからビルド

**前提**: Node.js / Rust / .NET 9 SDK

```powershell
# 1. フロント依存
cd app
npm install

# 2. センサーサイドカー（.NET, 自己完結 exe を生成して binaries へ配置）
..\tools\build-sidecar.ps1

# 3. PawnIO インストーラを配置（インストーラ同梱用）
#    https://github.com/namazso/PawnIO.Setup/releases から PawnIO_setup.exe を取得し
#    app/src-tauri/installer-deps/PawnIO_setup.exe に置く

# 4. 開発起動（管理者必須。UAC を承認）
..\tools\dev-admin.ps1

# 5. 配布ビルド（NSIS インストーラを生成）
npm run tauri build
```

生成物: `app/src-tauri/target/release/bundle/nsis/ZTKN_x.x.x_x64-setup.exe`

**注意**:
- `Assets/` `image/` `Panels/`、サイドカー exe、`PawnIO_setup.exe` は `.gitignore` 済み（ユーザーコンテンツ / 生成物 / サードパーティ）。
  ソースには含まれません。配布インストーラには同梱されます。
- サイドカーのプレリリース版は WinRing0 を廃止しており、温度は PawnIO 導入 + 管理者実行が前提です。

## ライセンス / サードパーティ

- センサー: [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor)（MPL 2.0）
- ドライバ: [PawnIO](https://pawnio.eu/) / [PawnIO.Setup](https://github.com/namazso/PawnIO.Setup)（署名済み）
