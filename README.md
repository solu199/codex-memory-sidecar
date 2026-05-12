# Codex Memory Sidecar

Codex app のためのローカル MCP メモリサイドカーです。

このサイドカーは、長期的な作業記憶を明示的な MCP ツールとして扱います。

- `search_memory`
- `write_memory`
- `update_memory`
- `forget_memory`
- `consolidate_memory`
- `memory_digest`
- `backup_memory`
- `verify_backup`
- `audit_memory`

メモリはローカルの SQLite に保存されます。キーワード検索には SQLite FTS を使います。Ollama が起動している場合は、書き込みと検索でローカル embedding も使い、ハイブリッド検索を行います。Ollama が使えない場合でも、ツールはキーワード検索にフォールバックし、warning を返します。

## 安全性

このツールは個人利用のローカルメモリを前提にしています。安全側の挙動として、次の方針を取ります。

- `forget_memory` はデフォルトで論理削除のみを行います。
- 物理削除を行うには `hardDelete: true` に加えて `confirmHardDelete: true` が必要です。
- `backup_memory` で SQLite データベースの明示バックアップを作成できます。
- `backup_memory` の `backupPath` を省略すると、データベース横の `backups/` に timestamp 付きで保存します。
- `verify_backup` でバックアップファイルが読み取れることと、保存件数を確認できます。
- `audit_memory` で最近の audit event を確認できます。
- `consolidate_memory` は dry-run 提案を返すだけで、自動適用はしません。
- 明らかな secret らしき内容は、明示 override なしでは保存を拒否します。
- 書き込み、更新、忘却、検索は audit event として記録されます。

## セットアップ

依存関係をインストールします。

```powershell
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" install
```

ビルドします。

```powershell
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run build
```

テストを実行します。

```powershell
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" test
```

## 設定

デフォルト設定を上書きしたい場合は、`config/memory-sidecar.toml` を作成します。

```toml
ollama_base_url = "http://localhost:11434"
embedding_model = "embeddinggemma"
maintenance_model = "qwen3"
database_path = "data/memory.sqlite"
default_search_limit = 8
consolidation_dry_run = true
```

環境変数でも上書きできます。

- `CODEX_MEMORY_DB`
- `OLLAMA_BASE_URL`
- `CODEX_MEMORY_EMBEDDING_MODEL`
- `CODEX_MEMORY_MAINTENANCE_MODEL`
- `CODEX_MEMORY_DEFAULT_SEARCH_LIMIT`
- `CODEX_MEMORY_CONSOLIDATION_DRY_RUN`

## Codex MCP 登録

ビルド後、Codex app には stdio server として次のコマンドを登録します。

```text
node C:\Users\hare1\Documents\Codex\tools\codex-memory-sidecar\dist\index.js
```

デフォルトのデータベースパスは次の通りです。

```text
C:\Users\hare1\Documents\Codex\tools\codex-memory-sidecar\data\memory.sqlite
```

## Ollama

想定しているローカル endpoint は次の通りです。

```text
http://localhost:11434
```

最初に使う embedding model としては `embeddinggemma` を推奨します。

```powershell
ollama pull embeddinggemma
```

このサイドカーにおける Ollama の役割は、embedding を作るローカルのメモリ司書です。最終的な推論は Codex が担当します。
