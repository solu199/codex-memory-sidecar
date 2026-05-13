# 実用テストチェックリスト

ローカルで安全に動く最小実用版として確認するための手順です。通常のメモリ DB を使う前に、一時 DB または事前バックアップで安全を確保してください。

## 前提

- Ollama アプリが起動している。
- `embeddinggemma` が pull 済み。
- 必要に応じて `qwen3` が pull 済み。
- このリポジトリで build が通る。

## 1. ローカル検証

```powershell
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" test
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run build
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run smoke:mcp
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run smoke:ollama
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run smoke:practical
```

期待値:

- test は全件 pass。
- build は TypeScript error なし。
- `smoke:mcp` は `ok: true`。
- `smoke:ollama` は `embeddingDimensions` が 0 より大きく、warnings が空。
- `smoke:practical` は一時 DB で write/search/digest/backup/dashboard の流れを確認し、`ok: true`。

## 2. Codex MCP 登録

Codex app には stdio server として次を登録します。

```text
node C:\Users\hare1\Documents\Codex\tools\codex-memory-sidecar\dist\src\index.js
```

通常 DB を汚したくない場合は、一時 DB 用の MCP server 登録を別に作り、その server プロセスに `CODEX_MEMORY_DB` が渡るようにします。PowerShell の現在のセッションだけで `$env:CODEX_MEMORY_DB` を設定しても、Codex app から起動される stdio server にその環境変数が渡らない場合は通常 DB を使います。

```powershell
$env:CODEX_MEMORY_DB="C:\Users\hare1\Documents\Codex\tools\codex-memory-sidecar\data\practical-test.sqlite"
node C:\Users\hare1\Documents\Codex\tools\codex-memory-sidecar\dist\src\index.js
```

Codex app に登録する場合も、上と同じ環境変数つきで起動される設定にしてください。env を渡せない登録方法なら、通常 DB で試す前に `backup_memory` を実行してから進めます。

## 3. MCP ツール確認

順に確認します。

- `health_check`: database と embedding が OK になる。
- `write_memory`: `projectPath` を付けて短い recall memory を保存する。
- `search_memory`: 同じ `projectPath` で保存した memory が返る。
- `memory_digest`: 同じ `projectPath` で digest に保存内容が入る。
- `start_memory_session`: health、stats、digest、repair 推奨をまとめて返す。
- `list_memory_summaries`: 本文ではなく summary と metadata だけが返る。
- `audit_memory`: 作成・検索イベントが確認でき、長い payload や secret が露出しない。
- `backup_memory`: backup path が作られる。
- `verify_backup`: backup が `ok: true` になる。
- `inspect_backup`: content ではなく summary だけが返る。
- `repair_memory_index`: health warning が出た場合に、backup 作成後 FTS index を再構築できる。

## 4. Project Scope 確認

1. project A の `projectPath` で memory を保存する。
2. project B の `projectPath` で同じ検索語を含む memory を保存する。
3. project A の `projectPath` で `search_memory` する。
4. project A と `global` だけが返り、project B は返らないことを確認する。
5. `includeCrossProject: true` を付けたときだけ project B も候補になることを確認する。

## 5. Dashboard 確認

```powershell
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run dashboard
```

ブラウザで `http://127.0.0.1:3737` を開きます。

期待値:

- Status が OK または原因が読める warning になる。
- memory/event 件数が表示される。
- Project Scopes に scope 別の active/total/latest が表示される。
- Recent Memories は summary だけで、本文は表示されない。
- Recent Events は payload を表示しない。

## 6. 後片付け

一時 DB を使った場合は、Codex app の MCP 登録や環境変数を通常運用の DB に戻します。不要な一時 DB と backup は、内容を確認してから手動で削除します。
