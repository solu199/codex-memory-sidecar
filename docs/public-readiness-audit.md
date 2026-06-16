# 公開後監査レポート

Codex Memory Sidecar を日本企業向けポートフォリオとして公開し、継続的に安全な状態で保つための監査結果です。

## 現在の状態

- GitHub repository: `solu199/codex-memory-sidecar`
- Visibility: public
- package: npm公開は想定せず、ローカルMCPツールとして扱う
- README: 日本語公開向けに再構成済み
- CI: GitHub Actionsで build / test / smoke を実行
- Issue / PR template: 追加済み
- Security / Contribution / License: 追加済み
- Ollama: 任意機能として整理済み
- Codex Skill: 配布用雛形を追加済み
- v0.1.0 release draft: `.github/releases/v0.1.0.md` として準備済み。最終タグ作成前に内容を更新する
- Dashboard画像: `docs/assets/dashboard-overview.png` としてREADMEに掲載
- GitHub About / topics: 設定済み。候補と運用メモは `docs/github-repository-metadata.md` に残す
- Memory Observatory bundle provenance: Issue #109 で vendored bundle の由来、再生成、checksum、notice、CI検証を整備中

## 確認結果

### 0. 公開後の最終確認

2026-06-12 時点で、GitHub repository は public です。公開済みの状態を前提に、tracked file、Git履歴、Issue/PR本文、依存関係、CI、ローカル生成物を確認しました。

確認結果:

- tracked file に `data/`、SQLite DB、`.env`、`dist/`、`node_modules/` は含まれていない
- 非テスト・非検出ロジックの範囲で、実シークレットらしき履歴ヒットはない
- `npm audit` と `npm audit --omit=dev` は依存更新後に 0 vulnerabilities
- build / test / smoke / skill install check はローカルで成功
- 最新の GitHub Actions は `main` で成功
- README は日本語のまま、概要、3分セットアップ、Dashboard画像、安全設計、詳細docs導線が冒頭で分かる構成に更新済み
- `CHANGELOG.md` と v0.1.0 GitHub Release draft を追加済み。Memory Observatory と bundle provenance の更新を反映する

注意点:

- 過去コミットと一部PR本文には、開発者ローカルのWindows絶対パスが残っている。秘密情報ではないが、公開履歴として見えるため、気になる場合は新しいクリーン公開リポジトリへ移す
- `docs/friend-explanation.html` は説明用のローカル生成物として扱い、公開対象に含めない

### 1. 個人利用前提の説明

README の主語は「Codex app 環境での利用を主に検証している、MCP対応AIエージェント向けのローカルメモリサイドカー」に変更済みです。MCP stdio server として他の MCP 対応クライアントでも同じ考え方で使える可能性はありますが、継続的に実運用・検証している対象は Codex app / Codex 環境です。

対応:

- #61 READMEを日本語公開向けに再構成
- #63 Codex Skillとして詳細運用プロトコルを切り出し
- #92 READMEを日本語ポートフォリオ向けに再整理してDashboard画像を追加

### 2. ローカル絶対パス

README と tracked docs の主要な手順から、開発者固有のローカルパスを汎用表記へ置換しました。

公開時・公開後の注意:

- untracked な作業ファイルは公開対象に含めない
- サンプルパスは `<repo>`、`<node-install-dir>` のような表記に寄せる
- Issue / PR / commit message にも、不要なローカル絶対パスや個人情報を書かない

Dashboard画像について:

- 公開用画像は実DBではなくデモDBを使って生成する
- ローカル絶対パス、ユーザー名、実メモリ本文、秘密情報が写っていないことを目視確認してからREADMEへ掲載する
- 画像は `docs/assets/dashboard-overview.png` に配置する

### 3. Ollama の扱い

Ollama は必須ではなく、SQLite FTS による基本運用と、Ollamaありのsemantic search強化に分けました。

対応:

- #62 Ollamaを任意機能として整理
- `embedding_mode = auto | off | ollama`
- `smoke:ollama` は任意の追加確認

### 4. 安全性

`data/`、`.env`、`dist/`、`node_modules/` は `.gitignore` で除外済みです。`SECURITY.md` で実DB、バックアップ、秘密情報、個人情報を公開しない方針を明文化しました。

対応:

- #64 SECURITY / CONTRIBUTING / LICENSEを追加
- `SECURITY.md`
- `CONTRIBUTING.md`
- `LICENSE`

### 5. GitHub運用

Issue起点、ブランチ、PR、CI、テスト結果を追える形に整備しました。

対応:

- #59 GitHub運用整備
- #69 CIのNode.js 20 deprecation annotation対応
- #91 v0.1.0リリース準備とCHANGELOG整備
- #92 READMEを日本語ポートフォリオ向けに再整理してDashboard画像を追加
- #93 GitHub About欄とtopicsをポートフォリオ向けに設定する
- #109 Memory Observatoryのvendored bundle由来と再現性を整理する

## 後続Issue

この監査から切り出した主要Issueの多くは完了済みです。v0.1.0公開準備として、次のIssueを継続管理しています。

- #59 GitHub運用整備: 完了
- #61 README公開向け再構成: 完了
- #62 Ollama optional化: 完了
- #63 Codex Skill化: 完了
- #64 SECURITY / CONTRIBUTING / LICENSE追加: 完了
- #69 CI annotation対応: 完了
- #91 v0.1.0リリース準備とCHANGELOG整備: release draft / CHANGELOG は整備済み。タグとGitHub Release作成前に最終確認する
- #92 READMEを日本語ポートフォリオ向けに再整理してDashboard画像を追加: 完了
- #93 GitHub About欄とtopicsをポートフォリオ向けに設定する: 完了
- #109 Memory Observatoryのvendored bundle由来と再現性を整理する: 対応中

## 公開後の定期チェック

公開後も、リリース前や大きなPRの直前に次を確認してください。

- `git status` に意図しない差分がない
- `data/`、`.env`、実DB、バックアップ、token、秘密情報が含まれていない
- untracked file を公開対象へ含めない
- README のセットアップ手順が現在の実装と一致している
- Issue/PRに不要な個人情報やローカル絶対パスがないか確認する
- `npm audit`、`npm audit --omit=dev`、`npm run build`、`npm test`、主要 smoke を実行する
- `npm run check:observatory-bundle` で Memory Observatory の vendored bundle が再生成結果とchecksumに一致することを確認する
- Release draft、CHANGELOG、README、Dashboard画像の内容が同じ説明になっているか確認する

## 判断

現時点で、公開後の基礎整備は一通り完了しています。今後は、GitHub上のIssue/PR本文、添付画像、untracked file、ローカルDB、バックアップ、依存関係の脆弱性を定期的に確認してください。
