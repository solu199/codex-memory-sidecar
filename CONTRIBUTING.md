# コントリビューションガイド

Codex Memory Sidecar への変更は、Issue起点で小さく進めます。ポートフォリオとしても読みやすいように、Issue、PR、コミットメッセージは日本語を基本にします。

## 開発フロー

1. 先にIssueを作り、目的、背景、完了条件を書きます。
2. `haru-codex/<issue-number>-<topic>` のようなブランチを切ります。
3. 変更は小さく、意図が追える単位でコミットします。
4. PR本文には概要、検証、関連Issueを書きます。
5. CIが通ってからマージします。

## ローカル確認

基本確認:

```powershell
npm install
npm run build
npm test
npm run smoke:mcp
npm run smoke:practical
```

Ollama を使う追加確認:

```powershell
npm run smoke:ollama
```

Ollamaなしで確認したい場合:

```powershell
$env:CODEX_MEMORY_EMBEDDING_MODE = "off"
npm run smoke:mcp
```

## 変更時の注意

- README、Issue、PR、コミットメッセージは日本語を基本にします。
- MCP tool、起動経路、Dashboard の挙動を変えた場合は、ビルド後にMCP serverの再起動が必要です。
- READMEと `AGENTS-memory-protocol.md` は、メモリ運用ルールを変えた時に一緒に確認します。
- Dashboardの表示が更新されない場合は、古いプロセスやポート再利用を疑ってください。
- `data/`、`.env`、実DB、バックアップ、秘密情報はコミットしません。

## PR前チェック

- `git status` で意図しない差分がない
- `git diff --check` が通る
- 必要なテストとsmokeが通る
- README/docsに古い手順や個人環境依存の説明が残っていない
- secret、token、実DB、個人情報が含まれていない

## Issue / PR の書き方

Issueには「背景」「やること」「完了条件」を書きます。PRには「概要」「検証」「関連Issue」を書きます。判断に迷った点や残したリスクがあれば、PR本文に明記してください。
