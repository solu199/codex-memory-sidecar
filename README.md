# Codex Memory Sidecar

Codex app 向けのローカル MCP メモリサイドカーです。個人利用を前提に、作業中の判断、好み、運用ルール、検証結果などをローカル SQLite に保存し、次回以降の作業で参照できるようにします。

## できること

- `write_memory` / `update_memory` / `forget_memory` でメモリを安全に管理します。
- `search_memory` は SQLite FTS と、Ollama が使える場合はローカル embedding を組み合わせて検索します。
- `memory_digest` は作業前に関連しそうなメモリを短くまとめます。
- `projectScope` / `projectPath` を使うと、同じプロジェクトのメモリと `global` メモリに絞り、別プロジェクトの混入を抑えます。
- `backup_memory` / `verify_backup` / `inspect_backup` で SQLite バックアップを作成・確認できます。
- `planBackupRetention` は既定バックアップの保持計画を dry-run で返します。ファイル削除はしません。
- `health_check`、`memory_stats`、read-only dashboard で状態を確認できます。
- `audit_memory` で直近の作成・更新・削除・検索イベントを確認できます。

## 安全性

このツールはローカル・個人利用を前提にしています。

- メモリ DB は既定で `data/memory.sqlite` に保存されます。
- 明らかな secret らしき内容は、明示的な override なしでは保存を拒否します。
- `forget_memory` は既定で論理削除です。物理削除には `hardDelete: true` と `confirmHardDelete: true` が必要です。
- 検索結果は既定で embedding 配列を返しません。必要な場合だけ `includeEmbedding: true` を指定します。
- バックアップ確認や inspection は read-only で実行します。
- audit payload 内の長い文字列は上限付きで短縮され、ログの肥大化を抑えます。
- 起動時メンテナンスは DB quick check、FTS 整合性確認、WAL checkpoint を軽く実行できます。

## セットアップ

```powershell
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" install
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run build
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" test
```

## Smoke Tests

```powershell
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run smoke:mcp
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run smoke:ollama
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run smoke:practical
```

- `smoke:mcp` は MCP server 登録と `health_check` を確認します。
- `smoke:ollama` は Ollama / `embeddinggemma` を使った embedding 検索を確認します。
- `smoke:practical` は一時 DB で write/search/digest/backup/dashboard の最小実用フローを確認します。

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

ビルド後、Codex app には stdio server として次のコマンドを登録します。

```text
node C:\Users\hare1\Documents\Codex\tools\codex-memory-sidecar\dist\index.js
```

既定の DB パス:

```text
C:\Users\hare1\Documents\Codex\tools\codex-memory-sidecar\data\memory.sqlite
```

## Ollama

既定 endpoint:

```text
http://localhost:11434
```

推奨 embedding model:

```powershell
ollama pull embeddinggemma
```

保守・要約系のローカルモデルとして `qwen3` を想定しています。

## projectScope の考え方

- `write_memory` に `projectScope` を渡すと、その文字列を正規化して保存します。
- `projectPath` を渡すと、絶対パスを hash 化した `project:<hash>` scope として保存します。生のローカルパスは scope 名に残しません。
- `search_memory` / `memory_digest` / `list_memory_summaries` / `consolidate_memory` / `inspect_backup` に同じ `projectScope` または `projectPath` を渡すと、その scope と `global` のメモリだけを既定で扱います。
- `memory_digest` は `projectPath` を検索文や audit payload に混ぜず、scope の判定だけに使います。
- 全プロジェクトを横断したい場合は `includeCrossProject: true` を指定します。

## 開発メモ

- このリポジトリは private package です。
- 通常の `npm` shim が環境によって壊れる場合は、上記の `node ... npm-cli.js` 形式で実行します。
- 作業プロトコルを Codex/AGENTS 系に組み込む場合は `AGENTS-memory-protocol.md` を参照してください。
- 実用テスト前の確認手順は `docs/practical-test-checklist.md` を参照してください。
- `memory_digest` の運用ルールは `docs/memory-digest-protocol.md` を参照してください。
