# AGENTS memory protocol template

この文書は、個人利用・ローカル運用の `codex-memory-sidecar` を Codex/AGENTS 系の作業手順へ組み込むためのテンプレートです。必要に応じて各プロジェクトの `AGENTS.md` に貼り付けるか、このファイルを参照してください。

## 基本方針

- メモリは、作業を速く安全にする補助情報です。ユーザーの最新指示、`AGENTS.md`、README/docs、実ファイル、git 履歴より優先しません。
- directive memory は通常メモリより強い運用指示ですが、system/developer instructions、ユーザーの最新指示、`AGENTS.md` よりは下位です。
- 参照・書き込みはローカル MCP tool 経由で行います。外部サービスへ自動送信しません。
- 新しいチャット開始時、または自己紹介・persona・memory・preferences に関する軽い質問でも、directive memory を読む必要があるため `start_memory_session(taskDescription, projectPath)` を呼びます。
- 非自明な作業では、最初に `start_memory_session(taskDescription, projectPath)` を呼び、directive、health、stats、backup retention、digest、修復推奨をまとめて確認します。
- `health_check` やメモリ状態確認だけを頼まれた場合でも、先に `start_memory_session` を単独で呼び、返ってきた directive、warnings、repair 推奨を読んでから `health_check` を呼びます。`start_memory_session` と `health_check` は並列実行しません。
- 設計判断、仕様解釈、既存方針の確認が必要なときは `search_memory` で関連する通常メモリを探します。
- 作業後、次回以降の助けになる知見がある場合だけ `propose_memory_update` を先に使い、重複候補を確認してから `write_memory` または `update_memory` を検討します。
- 強い運用指示を残す場合は `propose_directive_update` を先に使い、global directive か project directive かを確認してから `write_directive` を検討します。

## 優先順位

衝突がある場合は、次の順で判断します。

1. system / developer instructions
2. ユーザーの最新指示
3. `AGENTS.md`
4. directive memory
5. 通常メモリ（`core` / `recall` / `archival`）
6. 推論

directive memory が現在のユーザー指示や `AGENTS.md` と矛盾する場合は、directive memory を古い可能性がある情報として扱い、必要なら更新または無効化を提案します。

## 使うとよい場面

- 新しいチャット開始時、自己紹介、persona、memory、preferences、いつもの方針について聞かれたとき。
- 複数ファイルにまたがる変更、設計判断、運用手順、MCP tool 仕様、個人設定に関わる作業。
- 以前の実装意図、過去の失敗、ローカル環境の注意点を確認したいとき。
- ユーザーが「前に決めたこと」「いつもの方針」「この環境の設定」に触れているとき。
- 作業後に、再利用できる決定、検証結果、テストコマンド、注意点が残ったとき。

## 使わない場面

- 単純な typo 修正、明確な 1 ファイル変更、短い質問への回答など、メモリ参照の価値が低いとき。
- リポジトリ内の実ファイルを読めば十分に判断できるとき。
- ユーザーがメモリを使わないよう明示したとき。
- 検索語を何度も変えても新しい判断材料が増えないとき。

## 作業前プロトコル

1. 新しいチャット開始時、またはユーザーが identity、persona、memory、preferences、いつもの方針について聞いた場合は、軽い会話でも `start_memory_session` を呼びます。directive memory は MCP を呼んだ後でしか見えないためです。
2. タスクが非自明、または `health_check`、メモリ状態確認、Dashboard/backup/repair 状態確認なら `start_memory_session` を呼びます。
   - `taskDescription`: 今回の作業を 1 文で具体的に書きます。
   - `projectPath`: 対象リポジトリの絶対パスを渡します。
3. `ready: true` なら、返ってきた `directives`、digest、memory summary を参考にします。
4. `sessionGuidance.priorityOrder` を確認し、directive memory を通常メモリより先に読みます。
5. `start_memory_session` は作業開始の監査イベントを記録するため、完全な読み取り専用操作ではありません。event count を厳密に見る検証では、呼び出しにより件数が増える前提で扱います。
6. `repairRecommended: true` の場合は、作業に入る前に `repair_memory_index` を検討します。
7. `backupRetention.prunableCount` が増えている場合は、作業の区切りで `plan_backup_retention` を確認します。
8. 返ってきた内容を、現在のユーザー指示、`AGENTS.md`、README/docs、実ファイル、git 履歴で検証します。
9. メモリが古い・曖昧・矛盾している場合は推測として扱い、必要ならユーザーに確認します。

## 作業後プロトコル

- 次回も使う価値がある情報だけ保存します。
- 保存候補:
  - プロジェクト固有の運用ルール
  - 繰り返し発生した不具合と原因
  - ユーザーが明示した好みや制約
  - MCP tool、バックアップ、調査に関する検証結果
  - 通った検証コマンドや環境固有の注意点
- 保存しない候補:
  - 一時的な作業ログ
  - すぐ失効する状態
  - 秘密情報、トークン、個人情報の詳細
  - 実ファイルや git 履歴で十分に追跡できる内容
- 通常メモリに迷う場合は `propose_memory_update` を使います。
- directive memory に迷う場合は `propose_directive_update` を使います。

## directive memory の扱い

- `global` directive は、すべてのプロジェクトに適用したい長期的な方針に使います。
- `project` directive は、特定プロジェクトの README、テスト、ブランチ運用、MCP 利用ルールなど、より具体的な方針に使います。
- プロジェクト内で directive memory の変更候補が出た場合は、global にするか project にするかをユーザーに確認します。
- 古くなった directive は `disable_directive` で無効化します。無言で上書き・削除しません。
- directive memory 由来の主張は、directive id、content、sourceRef を添えて監査できるようにします。

## projectScope

- `projectPath` を渡すと、ローカルパスを hash 化した project scope が使われます。
- 検索時に scope が指定された場合、既定では同じ scope と `global` の通常メモリだけを返します。
- `start_memory_session` / `memory_digest` は `projectPath` を検索文に混ぜず、scope の判定だけに使います。
- 明示的に横断検索したいときだけ `includeCrossProject: true` を使います。

## 引用と監査

- メモリ由来の主張をユーザーに伝えるときは、可能な限り memory id、directive id、summary、sourceRef を添えます。
- 長く残すメモリでは、sourceRef を docs path、commit hash、PR 番号、issue 番号、または named chat/evaluation id に寄せます。
- 重要な判断は `audit_memory` で直近の参照・書き込みイベントを確認できる形にします。
- メモリと実ファイルが矛盾した場合は、実ファイルとユーザーの最新指示を優先し、必要に応じて古いメモリを更新します。

## バックアップと修復

- 作業開始時の `start_memory_session.backupRetention` で、既定バックアップの件数と削除候補を確認します。
- 大きな変更、削除、修復の前には `backup_memory` と `verify_backup` を使います。
- バックアップが増えてきたら `plan_backup_retention` を dry-run で確認します。ファイル削除は自動実行しません。
- 復元が必要になりそうな場合は `plan_backup_restore` で現在 DB とバックアップの差分感と手順を確認します。DB 置換は自動実行しません。
- `health_check`、`start_memory_session`、Dashboard が FTS warning を出した場合は、`repair_memory_index` を検討します。既定ではバックアップ作成と検証後に FTS index だけを再構築します。

## 強化版テンプレート

## Codex app カスタム指示用ブートストラップ

Codex app のパーソナライズのカスタム指示には、少なくとも次の短い指示を入れてください。`AGENTS.md` だけでは、挨拶や自己紹介のような軽い会話で MCP が呼ばれず、global directive の persona や preferences が読まれない場合があります。

```md
When a new chat starts, or when the user asks about your identity, persona, memory, preferences, usual policy, or what you remember, call `start_memory_session` from the `codex-memory-sidecar` MCP server before answering. Read returned directive memory first, then answer according to the documented priority order. Keep this bootstrap short; do not store secrets or unnecessary personal details.
```

```md
## Memory Protocol

Use the `codex-memory-sidecar` MCP server as the durable local memory layer for nontrivial Codex work.

- When a new chat starts, or when the user asks about identity, persona, memory, preferences, usual policy, or what you remember, call `start_memory_session` before answering so directive memory can be loaded.
- Before nontrivial work, call `start_memory_session` with the current task description and project path.
- When asked to run `health_check` or inspect memory status, call `start_memory_session` first as a separate tool call, read it, then run `health_check`; do not call them in parallel.
- Read the returned `directives`, `relevantMemories` / `memories`, `backupRetention`, `repairRecommended`, and `warnings` before making decisions.
- Note that `start_memory_session` records a startup audit event, so it is not purely read-only when comparing event counts.
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
