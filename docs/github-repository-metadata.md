# GitHub Repository Metadata 候補

Issue #93 のための GitHub About 欄と topics の候補です。
実際の `gh repo edit` は、ユーザー承認後に実行します。

## About description

AIエージェント向けのローカルMCPメモリ基盤。SQLiteで記憶・監査・バックアップ・復旧を扱う。

## Website

未設定のままにします。

## Topics

- `mcp`
- `ai-agents`
- `memory`
- `sqlite`
- `typescript`
- `local-first`
- `codex`
- `ollama`

## 承認後の設定コマンド

```powershell
gh repo edit solu199/codex-memory-sidecar `
  --description "AIエージェント向けのローカルMCPメモリ基盤。SQLiteで記憶・監査・バックアップ・復旧を扱う。" `
  --add-topic mcp `
  --add-topic ai-agents `
  --add-topic memory `
  --add-topic sqlite `
  --add-topic typescript `
  --add-topic local-first `
  --add-topic codex `
  --add-topic ollama
```
