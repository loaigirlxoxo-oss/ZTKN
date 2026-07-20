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

## 素材の追加（フォルダ構成と自動分類）

`Assets/` にパックを入れると、アプリが**フォルダ名・ファイル名から自動でカテゴリ分け**します（リネーム不要）。
**画像を直接含むフォルダ = 1つの「セット」** で、その相対パス名（小文字化）で判定されます。

**分類ルール**（上から順に判定。名前に含まれるキーワードで決定）:

| 条件（セットのパス名に含む） | 分類 |
|-|-|
| `guide` / `proposal` / `live` | 取り込まない（説明・デモ・デザイン案） |
| `background` / `backdrop` | 背景（クリックでパネル背景に設定） |
| `line-graph` | 線グラフ（選択中の折れ線にスタイル＋色を適用） |
| `frame` | 枠（画像として配置） |
| （上記以外で）画像が **8枚以上** | ゲージ。名前に `horizontal` か `bar` を含めば**棒ゲージ**、なければ**丸ゲージ**。連番 `state-00.png`…`state-NN.png` を値で切替 |
| 画像 7 枚以下・カバー1枚など | 取り込まない |

**タブ = トップのフォルダ名（パック名）**。パックごとにタブが分かれます。

構成例:

```
Assets/
  my-pack/                              ← タブ名（パック）
    backgrounds/
      background-main-1920x480.png      → 背景（"background" を含む）
    custom-gauges-circle/
      cpu-temp/
        state-00.png … state-15.png     → 丸ゲージ（8枚以上・連番を値で切替）
    custom-gauges-horizontal/
      load-bar/
        state-00.png … state-15.png     → 棒ゲージ（"horizontal" を含む）
    frames/
      frame-panel-760x220.png           → 枠（"frame" を含む）
    line-graph-assets/
      net-line-graph.png                → 線グラフ（"line-graph" を含む）
```

- **1枚絵**は `Assets/` ではなく `image/` フォルダへ（分類せずそのまま配置に使える）。
- ファイルを入れたらアプリの「更新」ボタンで再スキャンされます。
- 透過 PNG 対応。ゲージの連番は値 0〜100% を state-00〜state-NN に割り当てて切り替わります。

---

## AI 連携（Claude Code / Codex の使用量・承認待ち・実行中）

Claude Code / Codex CLI の状態をサブモニタに出せます。値は**すべてローカルから取得**（プライバシー安全・別サーバへ送信しない）。

### 1. 使用量（プラン残量% ・ 5h/7d 枠）— セットアップ不要

- **Claude**: `~/.claude/.credentials.json` の OAuth トークンで Claude 自身の `/api/oauth/usage` を叩き、5時間枠 / 7日枠の使用率とリセット時刻を取得（Claude UI と同じ実値）。
- **Codex**: ローカルの `codex app-server` に JSON-RPC で問い合わせ（`account/rateLimits/read`）。プランにより 7日枠のみ等あり。
- センサーピッカーの **Claude / Codex グループ**に「5h 使用率」「7d 使用率」「リセット」等が出るので、ゲージ・バー・数値・カウントダウン（`残り %t`）に割り当てられます。
- 更新間隔: Claude 約 60 秒 / Codex 約 300 秒。

### 2. 承認待ち / 実行中アラート — Claude Code / Codex フックのセットアップが必要

セッションが「実行中」「承認待ち（コマンド許可ダイアログで停止中）」の状態を、フックが状態ファイルに書き、ZTKN が読んで表示します。**複数インスタンス並行対応**（session_id で個別管理・作業フォルダ名で識別）。

**セットアップ:**

1. フックヘルパー `ztkn-hook.exe` をビルド: `cd app/src-tauri && cargo build -p ztkn-hook` → `target/debug/ztkn-hook.exe`（配布時は同梱）。**ztkn-hook はアプリ本体と別の独立クレート**なので tauri の `requireAdministrator` マニフェストを継承せず、非昇格の Codex/Claude から呼ばれても **UAC が出ない**。GUIサブシステムなので**黒窓も出ない**。
2. Claude Code の設定 `~/.claude/settings.json`（環境変数 `CLAUDE_CONFIG_DIR` があればそちら）の `hooks` に追記（**既存フックは保持してマージ**）。`<PATH>` は上の exe の絶対パス:

   | フックイベント | コマンド | 意味 |
   |-|-|-|
   | `UserPromptSubmit` | `"<PATH>" running` | ターン開始＝実行中 |
   | `PermissionRequest` | `"<PATH>" wait` | 承認待ち |
   | `PostToolUse` | `"<PATH>" running` | 承認後は実行中へ戻す |
   | `Stop` | `"<PATH>" clear` | ターン終了＝解除 |

   各コマンドはフック JSON を stdin で受け取り、`~/.claude/ztkn-state/<session_id>.json` に `{provider, status, cwd, ts}` を書き（`clear` は削除）します。

   **Codex CLI** の場合は `~/.codex/config.toml` に同じ 4 イベントを追記します。**Windows では Codex はフックを WSL 経由で実行する**ため、必ず **`command_windows` にネイティブ exe パス**を指定し、第 2 引数に `codex` を渡します（Claude と同じ ztkn-hook を `provider=codex` で共有）:

   ```toml
   [[hooks.PermissionRequest]]
   [[hooks.PermissionRequest.hooks]]
   type = "command"
   command = '/d/.../ztkn-hook.exe wait codex'           # 非Windowsフォールバック
   command_windows = 'D:\...\ztkn-hook.exe wait codex'   # Windowsはこちらが使われる
   # UserPromptSubmit→running / PostToolUse→running / Stop→clear も同様
   ```
   Codex TUI で `/hooks` を打つと有効化状態（Installed/Active）を確認できます。
3. ZTKN 側で「実行中 / 承認待ち」センサー（Claude / Codex グループ）や部品「**⚠ 承認待ち一覧**」（プロパティの「対象」で Claude / Codex / 全部を選択）を配置。内蔵の **Default テンプレ**には既に左右分割で入っています。

- **更新間隔: 2 秒**（フックは即時、ZTKN のポーリングが 2 秒）。
- **フォルダ検出**は決め打ちせず、各 CLI と同じ解決順（環境変数 → 実ホーム）を使うため、プロファイルや設定が D: 等の変則位置でも追従します。表示される作業フォルダはフックの `cwd` 実値です。

### 制限・注意

- **Codex の承認待ち/実行中も対応済み**（`config.toml` の hooks + `command_windows` でネイティブ実行）。Claude Code と同じ ztkn-hook を `provider=codex` で共有します。
- 上記フック設定は**このリポジトリの開発機向けのローカル設定**です。**配布パッケージでは未自動化** — 配布対応するには ① `ztkn-hook.exe` をインストーラ同梱 ② アプリ内「AI 連携を有効化」ボタンで Claude の `settings.json` と Codex の `config.toml`（`command_windows` にネイティブパス）を冪等マージ、が必要です。
- Claude Code / Codex を使っていない環境では何も起きません（エラーも出ません）。

---

## ソースからビルド

**開発起動**: 前提（下記）が揃っていれば、リポジトリ直下の **`dev.bat`** をダブルクリック → UAC 承認で開発モード起動。

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

# 4. 開発起動（管理者必須。UAC を承認）※ dev.bat ダブルクリックでも同じ
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

**ZTKN 本体**: © 2026 Lo-Ai Voice. **All rights reserved.**（[LICENSE](LICENSE) 参照）
公式配布バイナリは個人利用可。ソース/アプリの複製・改変・再配布・再利用は無断では不可（オープンソースではありません）。

利用・同梱するサードパーティ製ソフトの一覧とライセンスは [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) を参照。
いずれも再配布が許諾されたライセンスです（要点）:

- センサー: [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor)（**MPL-2.0**）
- ドライバ: [PawnIO](https://github.com/namazso/PawnIO)（**GPL-2.0**。IOControl 経由の分離＝リンク例外あり／単なる集合体として同梱）
- ランタイム: .NET 9（self-contained、再配布可）／ Tauri・Svelte・Konva 等は MIT / Apache-2.0

`Assets/` `image/` の素材とアイコンは利用者コンテンツで、上記ライセンスの対象外です（各自の出所に従う）。
