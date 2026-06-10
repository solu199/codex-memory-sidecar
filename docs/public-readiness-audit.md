# 公開前監査レポート

Codex Memory Sidecar を日本企業向けポートフォリオとして公開するための監査メモです。公開判断の前に、個人利用前提の情報、導入ハードル、GitHub上の見せ方、安全性を段階的に確認します。

## 現在の状態

- GitHub repository: `solu199/codex-memory-sidecar`
- Visibility: private
- package: `private: true`
- README: 日本語中心。ただし Codex app 個人利用前提、絶対パス、Ollama 前提の説明が残っている。
- CI: この監査時点で未整備だったため、Issue #59 で追加対象。
- Issue / PR template: この監査時点で未整備だったため、Issue #59 で追加対象。

## 公開前に解消したい主な課題

### 1. 個人利用前提の説明

README と docs には、個人利用や特定環境を前提にした表現が残っています。公開向けには「MCP対応AIエージェント向けのローカルメモリサイドカー」を主語にし、Codex app は利用例のひとつとして扱う方が読みやすくなります。

確認対象:

- `README.md`
- `AGENTS-memory-protocol.md`
- `docs/daily-operations.md`
- `docs/practical-test-checklist.md`
- `docs/friend-explanation.html`
- `2026-05-12-codex-memory-sidecar-design.md`

### 2. ローカル絶対パス

README と実用テスト手順には、開発者のローカルパスが例として残っています。公開向けには `<repo>` や `C:\path\to\codex-memory-sidecar` のような汎用表記に置き換えます。

例:

- `C:\Users\hare1\Documents\Codex\tools\codex-memory-sidecar`
- `C:\Users\hare1\Documents\Codex\2026-05-12\codex-rag-ai`

### 3. Ollama の扱い

現状は Ollama / `embeddinggemma` / `qwen3` の説明が目立つため、初見では Ollama が必須に見えます。公開向けには次の整理が必要です。

- Ollamaなし: SQLite FTS による基本検索で利用可能
- Ollamaあり: embedding による semantic search とモデル状態表示が有効
- smoke: `smoke:ollama` は optional 検証として扱う

### 4. 安全性

現状でも `data/`、`.env`、`dist/`、`node_modules/` は `.gitignore` に含まれています。公開前には、実DB、バックアップ、秘密情報、個人情報の詳細が git 管理対象に入っていないことを再確認します。

### 5. GitHub運用

ポートフォリオとして見せるため、今後は Issue 起点で開発します。Issue、ブランチ、PR、CI、テスト結果を追いやすくします。

今回追加するもの:

- `.github/ISSUE_TEMPLATE/bug_report.yml`
- `.github/ISSUE_TEMPLATE/feature_request.yml`
- `.github/ISSUE_TEMPLATE/public_readiness.yml`
- `.github/pull_request_template.md`
- `.github/workflows/ci.yml`

## 後続Issue候補

1. READMEを日本語公開向けに再構成する
2. Ollama optional 化を明確にする
3. Codex Skill を追加する
4. SECURITY.md / CONTRIBUTING.md / LICENSE を追加する
5. ローカル絶対パスと個人利用前提の表現を置換する
6. 公開前の最終secret scanと導入手順レビューを行う

## 判断

このリポジトリは、現時点では private のまま改善を進めるのが妥当です。公開前に上記の個人環境依存とOllama前提の説明を整理すれば、日本企業向けポートフォリオとして「MCPツール開発」「GitHub運用」「テスト」「安全設計」を見せやすい題材になります。
