# セキュリティポリシー

Codex Memory Sidecar は、ローカル SQLite にAIエージェントの作業メモリを保存するMCP serverです。公開リポジトリには、実運用DB、バックアップ、秘密情報、個人情報を含めない方針です。

## 公開してはいけないもの

- `data/` 配下の SQLite DB、WAL、SHM、バックアップ
- `.env`、API key、token、cookie、認証情報
- 個人を特定できる不要な詳細
- 実チャットの全文、秘密を含むmemory本文
- 社外秘のプロジェクト名、パス、接続先、顧客情報

`.gitignore` では `data/`、`.env`、`.env.*`、`dist/`、`node_modules/` を除外しています。公開前には `git status` と差分を確認してください。

## 脆弱性や危険な挙動の報告

このリポジトリのIssueで報告してください。ただし、秘密情報や実DBは貼らないでください。

報告に含めると助かる情報:

- 何が危険だと考えたか
- 再現手順
- 影響範囲
- 期待する挙動
- OS、Node.js、MCP client、Ollama利用有無

秘密情報を含む可能性がある場合は、まず概要だけをIssueに書き、詳細な共有方法を相談してください。

## ローカルメモリの扱い

- MCP memory は補助情報であり、README/docs、実ファイル、git履歴、ユーザーの最新指示より優先しません。
- `propose_memory_update` と `propose_directive_update` を使い、保存前に重複、重要度、sourceRef、秘密情報混入を確認します。
- directive memory は強い運用指示なので、古くなった場合は `disable_directive` で無効化し、無言で上書きしません。

## バックアップと修復

修復や危険なDB操作の前には、`backup_memory` と `verify_backup` を使ってください。`plan_backup_retention` と `plan_backup_restore` はdry-runとして扱い、バックアップ削除やDB置換を自動実行しないでください。
