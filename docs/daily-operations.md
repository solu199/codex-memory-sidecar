# 日常運用ガイド

Codex Memory Sidecar を毎日の開発で使うための短い手順です。個人利用、ローカル保存、安全優先を前提にします。

## 開発開始時

1. `health_check` を実行し、database と embedding が `ok: true` であることを確認します。
2. 複数ファイルにまたがる作業や過去の判断が関係する作業では、`memory_digest` を `projectPath` 付きで呼びます。
3. digest は参考情報として扱い、現在のユーザー指示と実ファイルを優先します。

## 書き込みルール

- `write_memory` は、ユーザーが明示したとき、または次回以降も役立つ判断が明確なときだけ使います。
- `core` は長く残る方針、`recall` は作業文脈、`archival` は履歴寄りの情報に使います。
- API key、token、password、個人情報の詳細は保存しません。
- 既存メモリの訂正で足りる場合は、新規作成より `update_memory` を優先します。

## 検索ルール

- 通常は `projectPath` を指定し、同一 project scope と `global` だけを検索します。
- 明示的に横断確認が必要なときだけ `includeCrossProject: true` を使います。
- 検索結果は memory id と summary を根拠にし、必要に応じて `read_memory` や `audit_memory` で確認します。

## バックアップと修復

- `backup_memory` は大きな修復、削除、設定変更の前に実行します。
- `health_check` や Dashboard が FTS warning を出した場合は、まず `backup_memory` か `repair_memory_index` の既定バックアップを使います。
- `repair_memory_index` は、バックアップ検証後に FTS index だけを再構築します。メモリ本文は変更しません。
- 修復後は `health_check` を再実行し、`warnings: []` を確認します。

## Dashboard

- Dashboard は読み取り専用の状態確認に使います。
- `Status`、`Database`、`Embedding`、`Warnings`、`Maintenance` を確認します。
- `Maintenance` で repair が推奨されている場合は、Dashboard 上で直接直すのではなく MCP の `repair_memory_index` を使います。

## 作業終了時

- 次回も役立つ決定、注意点、検証結果だけを保存します。
- 一時的な作業ログやすぐ失効する状態は保存しません。
- 不安がある場合は `audit_memory` で直近の書き込み・検索イベントを確認します。
