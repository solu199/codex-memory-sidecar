# Codex Memory Sidecar

Codex app 向けのローカル MCP メモリサイドカーです。個人利用を前提に、作業中の判断、好み、運用ルール、検証結果などをローカル SQLite に保存し、次回以降の作業で参照できるようにします。

## できること

- `write_memory` / `update_memory` / `forget_memory` でメモリを安全に管理します。
- `propose_memory_update` は DB を変更せず、保存候補、完全一致または近い重複候補、推奨 action を dry-run で返します。
- `consolidate_memory` は完全一致の重複と、近い内容の重複候補を dry-run で提案します。
- `search_memory` は SQLite FTS と、Ollama が使える場合はローカル embedding を組み合わせて検索します。
- `memory_digest` は作業前に関連しそうなメモリを短くまとめます。
- `start_memory_session` は作業開始時に health、stats、digest、修復推奨をまとめて確認します。
- `projectScope` / `projectPath` を使うと、同じプロジェクトのメモリと `global` メモリに絞り、別プロジェクトの混入を抑えます。
- `backup_memory` / `verify_backup` / `inspect_backup` で SQLite バックアップを作成、確認できます。
- `plan_backup_retention` は既定バックアップの保持計画を dry-run で返します。ファイル削除はしません。
- `plan_backup_restore` は現在 DB とバックアップを比較し、復元手順を dry-run で返します。DB 置換はしません。
- `repair_memory_index` でバックアップ作成後に FTS index だけを再構築できます。
- `health_check`、`memory_stats`、read-only dashboard で状態を確認できます。
- `audit_memory` で直近の作成、更新、削除、検索イベントを確認できます。

## 安全性

このツールはローカル、個人利用を前提にしています。

- メモリ DB は既定で `data/memory.sqlite` に保存されます。
- 明らかな secret らしい内容は、明示的な override なしでは保存を拒否します。
- `forget_memory` は既定で論理削除です。物理削除には `hardDelete: true` と `confirmHardDelete: true` が必要です。
- 検索結果は既定で embedding 配列を返しません。必要な場合だけ `includeEmbedding: true` を指定します。
- バックアップ確認と inspection は read-only で実行します。
- `repair_memory_index` は既定で先に SQLite バックアップを作成、検証してから FTS index を再構築します。
- audit payload 内の長い文字列は上限付きで短縮され、ログの肥大化を抑えます。

## セットアップ

PowerShell でリポジトリ直下へ移動してから実行します。

```powershell
cd C:\Users\hare1\Documents\Codex\tools\codex-memory-sidecar
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" install
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run build
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" test
```

通常の `npm` shim が環境によって壊れる場合があるため、上では `node ... npm-cli.js` 形式を使っています。

## Smoke Tests

```powershell
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run smoke:mcp
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run smoke:ollama
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run smoke:practical
```

- `smoke:mcp` は MCP server 登録と `health_check` を確認します。
- `smoke:ollama` は Ollama / `embeddinggemma` を使った embedding 検索を確認します。
- `smoke:practical` は一時 DB で write/search/digest/backup/retention/restore-plan/dashboard/repair/consolidation の最小実用フローを確認します。

## Dashboard

ローカル状態をブラウザで確認できます。`127.0.0.1` のみに bind し、メモリ本文や audit payload は表示しません。

```powershell
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run dashboard
```

起動後に開く URL:

```text
http://127.0.0.1:3737
```

## 設定

`config/memory-sidecar.toml` を作ると既定値を上書きできます。

```toml
ollama_base_url = "http://localhost:11434"
embedding_model = "embeddinggemma"
maintenance_model = "qwen3"
database_path = "data/memory.sqlite"
default_search_limit = 8
consolidation_dry_run = true
startup_integrity_check = true
startup_fts_sanity_check = true
startup_wal_checkpoint = true
auto_backup_on_startup = false
```

環境変数でも上書きできます。

- `CODEX_MEMORY_DB`
- `OLLAMA_BASE_URL`
- `CODEX_MEMORY_EMBEDDING_MODEL`
- `CODEX_MEMORY_MAINTENANCE_MODEL`
- `CODEX_MEMORY_DEFAULT_SEARCH_LIMIT`
- `CODEX_MEMORY_CONSOLIDATION_DRY_RUN`
- `CODEX_MEMORY_STARTUP_INTEGRITY_CHECK`
- `CODEX_MEMORY_STARTUP_FTS_SANITY_CHECK`
- `CODEX_MEMORY_STARTUP_WAL_CHECKPOINT`
- `CODEX_MEMORY_AUTO_BACKUP_ON_STARTUP`

## Codex MCP 登録

ビルド後、Codex app には stdio server として次の内容を登録します。

```text
command: node
args: C:\Users\hare1\Documents\Codex\tools\codex-memory-sidecar\dist\src\index.js
cwd: C:\Users\hare1\Documents\Codex\tools\codex-memory-sidecar
```

既定の DB パス:

```text
C:\Users\hare1\Documents\Codex\tools\codex-memory-sidecar\data\memory.sqlite
```

別 DB を使う場合は MCP 登録の環境変数に `CODEX_MEMORY_DB` を設定します。PowerShell の現在セッションだけに `$env:CODEX_MEMORY_DB` を設定しても、Codex app から起動される stdio server には通常引き継がれません。

## Ollama

既定 endpoint:

```text
http://localhost:11434
```

推奨 embedding model:

```powershell
ollama pull embeddinggemma
```

保守や要約用のローカルモデルとして `qwen3` を想定しています。

## projectScope の考え方

- `write_memory` に `projectScope` を渡すと、その文字列を正規化して保存します。
- `projectPath` を渡すと、絶対パスを hash 化した `project:<hash>` scope として保存します。生のローカルパスは scope 名に残しません。
- `search_memory` / `memory_digest` / `list_memory_summaries` / `consolidate_memory` / `inspect_backup` に同じ `projectScope` または `projectPath` を渡すと、その scope と `global` のメモリだけを既定で扱います。
- 全プロジェクトを横断したい場合は `includeCrossProject: true` を指定します。

## 日常運用

1. 作業開始時に `start_memory_session` を呼び、health、stats、digest、修復推奨を確認します。
2. メモリを残すか迷う場合は、先に `propose_memory_update` を使い、完全一致または近い重複候補を確認します。
3. 同じ内容が増えてきたと感じたら `consolidate_memory` を dry-run で実行し、完全一致または近い重複候補を確認します。
4. 大きな変更や削除前には `backup_memory` と `verify_backup` を実行します。
5. バックアップが増えてきたら `plan_backup_retention` で保持対象と削除候補を確認します。
6. 復元が必要になりそうな場合は、先に `plan_backup_restore` で現在 DB とバックアップの差分感と手順を確認します。
7. Dashboard は状態確認専用として使い、修復や変更は MCP tool から実行します。

詳しい確認手順:

- 実用テスト前: `docs/practical-test-checklist.md`
- 日常運用: `docs/daily-operations.md`
- digest 運用: `docs/memory-digest-protocol.md`
- Codex/AGENTS 系への組み込み: `AGENTS-memory-protocol.md`

## 開発メモ

- このリポジトリは private package です。
- README は日本語を正とします。
- MCP tool を追加、削除、または挙動変更した後は `npm run build` 相当のビルド後、Codex app 側で MCP server の再起動が必要です。
