# サードパーティ・ライセンス表記 / Third-Party Notices

ZTKN は以下のサードパーティ製ソフトウェアを利用・同梱しています。いずれも再配布が許諾された
ライセンスです（下記条件の順守が前提）。ソースは各リンク先で入手できます。

## 同梱バイナリ / Bundled binaries

| コンポーネント | 用途 | ライセンス | ソース |
|-|-|-|-|
| **LibreHardwareMonitorLib** | センサー取得（サイドカー） | **MPL-2.0** | https://github.com/LibreHardwareMonitor/LibreHardwareMonitor |
| **PawnIO** (`PawnIO_setup.exe`) | 温度読取用の署名済み ring0 ドライバ | **GPL-2.0**（IOControl 経由の分離＝リンク例外あり） | https://github.com/namazso/PawnIO ／ https://github.com/namazso/PawnIO.Setup |
| **.NET 9 Runtime** | サイドカー実行基盤（self-contained 同梱） | MIT / .NET Library License（再配布可） | https://github.com/dotnet/runtime |

- **PawnIO (GPL-2.0)** は独立したドライバ／インストーラとして**そのまま同梱**しており、本体アプリとは
  デバイス IOControl インターフェース経由で通信する分離構成（GPL のリンク例外に該当）＝単なる集合体(mere aggregation)。
  本体アプリのライセンスには影響しません。PawnIO のソースは上記リポジトリで入手可能です。
- **LibreHardwareMonitorLib (MPL-2.0)** はライブラリとして利用。MPL 対象ファイルのソースは上記で入手可能です。

## ビルドに含まれる主なライブラリ / Key libraries compiled in

| コンポーネント | ライセンス |
|-|-|
| Tauri / wry / tao ほか Rust クレート | MIT / Apache-2.0 |
| tauri-plugin-autostart, tauri-plugin-opener | MIT / Apache-2.0 |
| SvelteKit / Svelte | MIT |
| Konva.js | MIT |
| Vite（ビルド時のみ） | MIT |

フロントエンド依存は MIT / Apache-2.0 / ISC / BSD / CC0 / BlueOak のみ（強コピーレフトなし）。

## ユーザーコンテンツ / User content（配布物に同梱される場合）

`Assets/`・`image/` の素材およびアプリアイコンは ZTKN のコードではなく**利用者が用意したコンテンツ**です。
これらの再配布可否は各素材の出所・生成物の利用規約に従います（本リポジトリのライセンス対象外）。
