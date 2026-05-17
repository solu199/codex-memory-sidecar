# 日常運用ガイド

Codex Memory Sidecar を毎日の開発で使うための短い手順です。個人利用、ローカル保存、安全優先を前提にします。

## 開発開始時

1. `start_memory_session` を `taskDescription` と `projectPath` 付きで呼びます。
2. `ready: true` なら、返ってきた digest と memory summary を参考にします。
3. `repairRecommended: true` の場合は、作業に入る前に `repair_memory_index` を検討します。
4. digest は参考情報として扱い、現在のユーザー指示と実ファイルを優先します。

## 書き込みルール

- `write_memory` は、ユーザーが明示したとき、または次回以降も役立つ判断が明確なときだけ使います。
- 迷う場合は先に `propose_memory_update` を使い、保存候補、重複候補、推奨 action を確認します。
- `core` は長く残る方針、`recall` は作業文脈、`archival` は履歴寄りの情報に使います。
- API key、token、password、個人情報の詳細は保存しません。
- 既存メモリの訂正で足りる場合は、新規作成より `update_memory` を優先します。

## 検索ルール

- 通常は `projectPath` を指定し、同一 project scope と `global` だけを検索します。
- 作業開始時は個別の `health_check` と `memory_digest` より、まず `start_memory_session` を優先します。
- 明示的に横断確認が必要なときだけ `includeCrossProject: true` を使います。
- 検索結果は memory id と summary を根拠にし、必要に応じて `read_memory` や `audit_memory` で確認します。

## 重複整理

- 重複が気になったら `consolidate_memory` を dry-run で実行します。
- `duplicate_content` は正規化後に同じ内容の候補です。
- `near_duplicate_content` は同じ layer 内で語彙がかなり近い候補です。
- 提案だけでは DB は変更されません。実際に統合する前に summary、tags、project scope を確認します。

## バックアップと修復

- `backup_memory` は大きな修復、削除、設定変更の前に実行します。
- バックアップが増えてきたら `plan_backup_retention` を使い、保持対象と削除候補を dry-run で確認します。
- 復元が必要になりそうな場合は `plan_backup_restore` を使い、現在 DB とバックアップの count/health と手順を dry-run で確認します。
- `health_check` や Dashboard が FTS warning を出した場合は、まず `backup_memory` と `repair_memory_index` の既定バックアップを使います。
- `repair_memory_index` は、バックアップ検証後に FTS index だけを再構築します。メモリ本文は変更しません。
- 修復後は `health_check` を再実行し、`warnings: []` を確認します。

## Dashboard

- Dashboard は読み取り専用の状態確認に使います。
- `Status`、`Database`、`Embedding`、`Warnings`、`Maintenance` を確認します。
- `Maintenance` で repair が推奨されている場合は、Dashboard から直接直すのではなく MCP の `repair_memory_index` を使います。

## 作業終了時

- 次回も役立つ決定、注意点、検証結果だけを保存します。
- 一時的な作業ログやすぐ失効する状態は保存しません。
- 不安がある場合は `audit_memory` で直近の書き込み、検索イベントを確認します。
