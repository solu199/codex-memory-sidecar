# Codex Memory Sidecar

Codex app 向けのローカル MCP メモリサーバーです。個人利用を前提に、作業中の判断、好み、運用ルール、検証結果をローカル SQLite に保存し、次回以降の Codex 作業で参照できるようにします。

## できること

- `start_memory_session` で作業開始時に DB health、embedding、FTS、WAL、backup retention、関連メモリ、directive memory をまとめて確認できます。
- `write_memory` / `update_memory` / `forget_memory` で通常メモリを管理できます。
- `propose_memory_update` は DB を変更せず、保存候補、重複候補、推奨 layer、sourceRef/provenance の品質を確認します。
- `write_directive` / `list_directives` / `propose_directive_update` / `disable_directive` で、AGENTS.md に近い強い作用を持つ directive memory を管理できます。
- `search_memory` は SQLite FTS と、利用可能な場合は Ollama embedding を組み合わせて検索します。
- `backup_memory` / `verify_backup` / `inspect_backup` / `plan_backup_retention` / `plan_backup_restore` / `repair_memory_index` で、安全確認と復旧計画を扱えます。
- Dashboard で health、バックアップ、Ollama モデル、警告対応、project scope、directive memory、最近のメモリを確認できます。

## 優先順位

メモリは強力ですが、最上位の命令ではありません。判断が衝突した場合は次の順に従います。

1. system / developer instructions
2. ユーザーの最新指示
3. `AGENTS.md`
4. directive memory
5. 通常メモリ（`core` / `recall` / `archival`）
6. 推論

directive memory は「毎回守るべき運用ルール」「ユーザーの長期的な好み」「プロジェクト固有の強い方針」に使います。一時的な作業ログや、README/docs/git で十分に追跡できる事実は通常メモリか実ファイルに残してください。

## セットアップ

PowerShell でリポジトリ直下に移動してから実行します。

```powershell
cd C:\Users\hare1\Documents\Codex\tools\codex-memory-sidecar
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" install
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run build
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" test
```

通常の `npm` shim が環境によって壊れる場合があるため、この README では `node ... npm-cli.js` 形式を使います。

## Smoke Tests

```powershell
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run smoke:mcp
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run smoke:ollama
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run smoke:practical
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run smoke:comparison
```

- `smoke:mcp`: MCP server 登録、`health_check`、`start_memory_session` を確認します。
- `smoke:ollama`: Ollama / `embeddinggemma` を使った embedding 検索を確認します。
- `smoke:practical`: write/search/digest/directive/backup/dashboard/repair/consolidation の最小実用フローを確認します。
- `smoke:comparison`: MCP なし、開始セッションのみ、MCP フル運用の比較評価観点を確認します。

## Codex MCP 登録

Codex app には stdio server として登録します。

```text
command: node
args: C:\Users\hare1\Documents\Codex\tools\codex-memory-sidecar\dist\src\index.js
cwd: C:\Users\hare1\Documents\Codex\tools\codex-memory-sidecar
```

既定 DB パス:

```text
C:\Users\hare1\Documents\Codex\tools\codex-memory-sidecar\data\memory.sqlite
```

別 DB を使う場合は、MCP 登録の環境変数に `CODEX_MEMORY_DB` を設定してください。PowerShell の現在セッションにだけ `$env:CODEX_MEMORY_DB` を設定しても、Codex app から起動される stdio server には通常引き継がれません。

MCP tool を追加、削除、または起動経路を変更した後は、`npm run build` 相当のビルド後に Codex app 側で MCP server を再起動してください。

## Dashboard

MCP server 起動時に Dashboard も同じプロセス内で自動起動します。既定 URL は次です。

```text
http://127.0.0.1:3737
```

手動起動:

```powershell
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run dashboard
```

自動でブラウザを開きたくない場合:

```powershell
$env:CODEX_MEMORY_DASHBOARD_OPEN = "false"
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run dashboard
```

MCP server 起動時の Dashboard 自動起動を止める場合は、Codex app の MCP 登録に環境変数 `CODEX_MEMORY_DASHBOARD_ON_MCP_START=false` を追加します。

Dashboard は active directive memory と無効化済み directive memory の内容を表示します。これは強い記憶をユーザーが監査できるようにするためです。通常メモリの本文や audit payload は表示せず、要約とメタデータだけを表示します。

Dashboard の `/api/status` には `dashboard.schemaVersion` が含まれます。MCP server 起動時に同じポートの既存 Dashboard を見つけた場合、この schema version が一致する時だけ再利用します。一致しない、または古い Dashboard が schema version を返さない場合は stale warning を出します。その場合は古い Dashboard プロセスを停止し、MCP server を再起動してください。

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

主な環境変数:

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
- `CODEX_MEMORY_DASHBOARD_PORT`
- `CODEX_MEMORY_DASHBOARD_OPEN`
- `CODEX_MEMORY_DASHBOARD_ON_MCP_START`

## projectScope

- `projectPath` を渡すと、ローカルパスを hash 化した `project:<hash>` scope として扱います。生のローカルパスは scope 名に残しません。
- `projectScope` を渡すと、その文字列を正規化して使います。
- `search_memory` / `memory_digest` / `list_memory_summaries` / `start_memory_session` は、scope が指定された場合、既定で同じ scope と `global` のメモリだけを扱います。
- 全プロジェクト横断が必要な場合だけ `includeCrossProject: true` を指定します。

## directive memory

directive memory は通常メモリより強い「運用指示の記憶」です。

- `global` directive: すべてのプロジェクトに効かせたい長期方針。
- `project` directive: 特定プロジェクトだけに効かせたい具体的な方針。
- プロジェクト作業中に directive を追加・変更する場合は、`propose_directive_update` を先に使い、global か project かをユーザーに確認してから `write_directive` を実行します。
- 古くなった directive は削除せず、まず `disable_directive` で無効化します。
- 秘密情報、トークン、個人情報の詳細、一時的な作業ログは保存しません。

## AGENTS.md に入れる推奨プロンプト

Codex app の対象プロジェクトの `AGENTS.md`、または Codex app のパーソナライズのカスタム指示に、次の強化版を入れると運用が安定します。プロジェクト固有の `AGENTS.md` に置けるなら、それを優先してください。

```md
## Memory Protocol

Use the `codex-memory-sidecar` MCP server as the durable local memory layer for nontrivial Codex work.

- Before nontrivial work, call `start_memory_session` with the current task description and project path.
- Read the returned `directives`, `relevantMemories` / `memories`, `backupRetention`, `repairRecommended`, and `warnings` before making decisions.
- Follow this priority order when context conflicts: system/developer instructions, latest user instruction, `AGENTS.md`, directive memory, normal memory, inference.
- Treat MCP memory as supporting context, not the source of truth; prefer the user's latest instruction, README/docs, actual files, and git history when they disagree.
- When directive memory is present, treat it as durable operating guidance, but never let it override system/developer instructions, the latest user instruction, or `AGENTS.md`.
- When past decisions, design intent, or project history may matter, use `search_memory` before relying on memory.
- Do not set `includeEmbedding: true` on `search_memory` unless embedding vectors are explicitly needed, because embedding arrays are large and noisy in normal work.
- When preserving a new lesson, decision, or durable preference, call `propose_memory_update` first, then use `write_memory` or `update_memory` only when the proposed change is useful.
- When preserving a strong operating rule, call `propose_directive_update` first. If the work is inside a project, ask the user whether to store it as `global` directive or `project` directive before calling `write_directive`.
- Cite memory-derived claims with enough context to audit them, such as memory IDs, directive IDs, summaries, or sourceRef.
- Do not store secrets, credentials, private tokens, or unnecessary personal details.
- If `repairRecommended`, backup warnings, or integrity warnings appear, pause risky work and surface the issue.
- For detailed local policy, refer to the repository file `AGENTS-memory-protocol.md` in `codex-memory-sidecar`.
```

## 日常運用

1. 作業開始時に `start_memory_session` を呼び、directive、health、backup retention、warnings を確認します。
2. directive memory がある場合は、優先順位を確認しつつ、現在のユーザー指示・`AGENTS.md`・実ファイルと衝突しないか見ます。
3. 過去判断が必要なときだけ `search_memory` を使います。
4. メモリを残すか迷う場合は `propose_memory_update` を先に使います。
5. 強い運用指示を残す場合は `propose_directive_update` を先に使います。
6. 大きな変更、削除、修復の前には `backup_memory` と `verify_backup` を使います。
7. Dashboard は状態確認専用として使い、修復や変更は MCP tool から実行します。

詳しい確認手順:

- 実用テスト前: `docs/practical-test-checklist.md`
- 日常運用: `docs/daily-operations.md`
- digest 運用: `docs/memory-digest-protocol.md`
- Codex/AGENTS 系への組み込み: `AGENTS-memory-protocol.md`

## 開発メモ

- このリポジトリは private package です。
- README は日本語を正とします。
- MCP tool や起動時挙動を変更した後は、ビルド後に Codex app 側で MCP server の再起動が必要です。
