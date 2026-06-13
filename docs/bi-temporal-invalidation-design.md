# bi-temporal memory invalidation 設計

Issue: #99

## 目的

古いメモリをすぐ削除せず、「いつから有効だったか」「いつ、何により無効になったか」を追えるようにします。狙いは、現在の回答では古い情報を混ぜない一方で、監査や復旧では過去の判断経緯をたどれる状態にすることです。

Graphiti / Zep の Temporal Fact Management は、会話や業務データから変化する事実を時間つきで扱う発想が参考になります。ただし Codex Memory Sidecar はローカル SQLite の MCP memory layer なので、最初の実装では temporal knowledge graph ではなく、通常メモリ行に最小限の validity metadata を足す方針にします。

## 用語

- `valid_from`: そのメモリが有効になった日時。既存データでは `created_at` と同じ値で backfill します。
- `invalidated_at`: そのメモリが現在の通常利用から外れた日時。未設定なら現在も有効です。
- `invalidated_by_ref`: 無効化の根拠。`memory:<id>`、`git:<hash>`、`pr:#123`、`issue:#123`、`docs/path.md` など追跡できる sourceRef を入れます。
- `invalidation_reason`: 人間が読む短い理由。例: `newer project rule superseded this memory`。
- `transaction_time`: DB上で記録・更新された時刻。既存の `created_at` / `updated_at` がこれに近い役割を持ちます。

## status との関係

既存の `status` は UI と検索の粗い状態を表します。bi-temporal metadata は、その状態変更の根拠と時点を補います。

| 状態         | 検索既定 | 意味                                             | temporal metadata                                                                    |
| ------------ | -------- | ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `active`     | 含める   | 現在の通常利用対象                               | `invalidated_at = null`                                                              |
| `superseded` | 除外     | 新しい記憶に置き換えられたが、履歴として残す     | `invalidated_at` と `invalidated_by_ref` を必須にする                                |
| `forgotten`  | 除外     | 通常利用から外し、明示 opt-in なしでは読ませない | `invalidated_at` と `invalidation_reason` を必須にする。hard delete 時は行を削除する |

`superseded` は「より新しい、またはより正しいメモリに置き換えた」状態です。`forgotten` は「通常利用から外すべき」状態であり、プライバシー・安全性・ユーザー判断による除外も含みます。

## migration 方針

最初の migration PR では、次のカラム追加だけを行います。

```sql
ALTER TABLE memories ADD COLUMN valid_from TEXT;
ALTER TABLE memories ADD COLUMN invalidated_at TEXT;
ALTER TABLE memories ADD COLUMN invalidated_by_ref TEXT;
ALTER TABLE memories ADD COLUMN invalidation_reason TEXT;
```

backfill:

- `valid_from`: 既存 `created_at` を入れる。
- `invalidated_at`: `status != 'active'` の既存行では `updated_at` を入れる。`active` は `null`。
- `invalidated_by_ref`: 既存行では不明なため `migration:bi-temporal-v1` を入れる。ただし `active` は `null`。
- `invalidation_reason`: 既存行では `Backfilled from existing memory status during bi-temporal migration.`。

互換性:

- 既存バックアップは、restore 後に通常 migration を通せば読める状態にします。
- `inspect_backup` は古い schema も読めるよう、metadata がない場合は `null` として扱います。
- `verify_backup` は schema version の差を警告にしても、旧バックアップを即失敗扱いにはしません。

## read / search / digest 方針

既定の挙動は変えません。

- `search_memory`: 既定では `active` だけを返します。`includeSuperseded` が true の場合のみ `superseded` を含め、`forgotten` は今まで通り別 opt-in にします。
- `read_memory`: `superseded` は読めますが、レスポンスに `invalidated_at` / `invalidated_by_ref` / `invalidation_reason` を表示します。`forgotten` は明示 opt-in が必要です。
- `memory_digest` / `start_memory_session`: 既定では active の要約だけにします。無効化済みメモリを参照した場合は、根拠として `superseded by ...` を短く示します。
- recency scoring: `active` は `updated_at` と `valid_from` を使い、`superseded` は既定ランキングから外します。

## Dashboard / audit 方針

Dashboard:

- stats に `invalidated` 件数を追加する場合は、`superseded + forgotten` と混同しない説明を添えます。
- recent memories では、無効化済みを表示する opt-in を用意した時だけ `invalidated_at` と `invalidated_by_ref` を出します。
- 通常画面では本文を出さない方針を維持し、summary と metadata だけにします。

Audit:

- `memory_events` に `superseded` event type を追加するか、既存 `updated` event の payload で扱うかを migration PR で決めます。
- `forget_memory` は `invalidated_at`、`invalidated_by_ref`、`invalidation_reason` を audit payload に残します。
- `update_memory` が旧メモリを supersede する設計に変わる場合、旧IDと新IDの対応を payload に残します。

## API / tool 変更案

段階的に進めます。

1. Schema migration と型追加
   - `Memory` に temporal metadata を追加。
   - migration/backfill/backup compatibility tests を追加。
2. Invalidation write path
   - `forget_memory` に `invalidatedByRef` を任意で追加。
   - `update_memory` は当面 existing row update を維持し、再embed問題の解決PRと競合させない。
3. Supersede path
   - 新 tool `supersede_memory` または `update_memory({ mode: "supersede" })` を検討。
   - 旧メモリを `superseded` にし、新メモリを `active` として作る。
4. Display path
   - `read_memory`、`list_memory_summaries`、Dashboard、audit 表示を拡張。

## テスト計画

- 旧 schema DB から migration して、active / superseded / forgotten の backfill が期待通りになる。
- 旧バックアップを `verify_backup` / `inspect_backup` できる。
- `search_memory` は既定で invalidated memory を返さない。
- `includeSuperseded` と `includeForgotten` の opt-in が独立して動く。
- `forget_memory` が `invalidated_at` と audit payload を残す。
- Dashboard は本文を漏らさず metadata だけを表示する。
- `smoke:practical` に最低1つの invalidation 確認を足す。

## PR 分割

Issue #99 は設計で閉じます。実装は次の Issue / PR に分けるのが安全です。

- PR 1: schema migration、型、backfill、backup compatibility tests
- PR 2: `forget_memory` / read / search / digest の temporal metadata 表示
- PR 3: supersede API と update_memory の再embed方針整理
- PR 4: Dashboard 表示と practical smoke 拡張

## 採用しないこと

- 最初から temporal knowledge graph を実装しない。
- migration、API、Dashboard、recency scoring、再embed修正を1つのPRに詰め込まない。
- 無効化済みメモリを既定検索に混ぜない。
- `forgotten` の本文を Dashboard や digest に出さない。

## 参考

- Zep: A Temporal Knowledge Graph Architecture for Agent Memory: https://arxiv.org/abs/2501.13956
- Graphiti: https://github.com/getzep/graphiti
- Don't Ask the LLM to Track Freshness: A Deterministic Recipe for Memory Conflict Resolution: https://arxiv.org/abs/2606.01435
