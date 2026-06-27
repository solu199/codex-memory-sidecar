# node:sqlite 移行調査

Issue: #98

## 結論

現時点では `better-sqlite3` から `node:sqlite` へすぐ置き換えない。まずは `MemoryStore` のDB操作を小さな互換レイヤーに閉じ込め、その後にPoC PRで `node:sqlite` backendを選択できるようにするのが安全。

理由は次の通り。

- Node.js 22系の `node:sqlite` は公式ドキュメント上で Active development 扱いで、実行時にも `ExperimentalWarning` が出る。
- このリポジトリのCIは Node.js 22 を使っているが、必要な `timeout` option は Node.js 22.16.0 以降で追加されたため、下限バージョンを明示する必要がある。
- `prepare()` / `exec()` / `backup()` / FTS5 trigram / WAL checkpoint はローカル Node.js v22.17.0 で動作確認できた。
- `better-sqlite3` の `pragma()` helper、`transaction()` helper、`db.backup()` method、`readonly` / `fileMustExist` optionとはAPI差分がある。

## 現在の利用状況

`src/memory-store.ts` では主に次を使っている。

| 用途                 | 現在の `better-sqlite3` API                                   | `node:sqlite` 側の扱い                                                   |
| -------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| DB open              | `new Database(databasePath)`                                  | `new DatabaseSync(databasePath, { timeout })`                            |
| read-only backup検証 | `new Database(path, { readonly: true, fileMustExist: true })` | `new DatabaseSync(path, { readOnly: true })`。存在確認は呼び出し前に行う |
| SQL実行              | `db.exec(sql)`                                                | `db.exec(sql)`                                                           |
| statement            | `db.prepare(sql).get/all/run()`                               | `db.prepare(sql).get/all/run()`                                          |
| PRAGMA helper        | `db.pragma("busy_timeout = 5000")`                            | `db.exec("PRAGMA ...")` または `prepare("PRAGMA ...")`                   |
| transaction          | `db.transaction(fn)`                                          | helperなし。`BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` をラップする       |
| backup               | `await db.backup(path)`                                       | `import { backup } from "node:sqlite"; await backup(db, path)`           |
| close                | `db.close()`                                                  | `db.close()`                                                             |

## 重要機能の確認

ローカル Node.js v22.17.0 で確認したこと。

- `CREATE VIRTUAL TABLE ... USING fts5(... tokenize = 'trigram')` が成功する。
- `MATCH` 検索で trigram FTS の結果を取得できる。
- `PRAGMA journal_mode = WAL` と `PRAGMA wal_checkpoint(PASSIVE)` が動作する。
- `backup(db, backupPath)` でバックアップファイルを作成できる。
- `DatabaseSync` に `transaction` / `pragma` / `backup` method はない。

この確認だけでは、全テストを `node:sqlite` backendで通せることまでは保証しない。特に migration、repair、backup inspection、Dashboard status、MCP smoke は互換レイヤー導入後にまとめて通す必要がある。

## リスク

- Node.js 22系では `node:sqlite` がまだ Active development のため、公開ツールの既定backendを即変更すると利用者環境で壊れる可能性がある。
- GitHub Actions の `node-version: "22"` は最新の22系を取るが、利用者のローカルNodeが 22.16.0 未満だと `timeout` optionが使えない。
- `transaction()` helperがないため、FTS再構築や複数テーブル更新で手書きtransactionの品質が必要になる。
- `backup()` は関数APIなので、既存の `MemoryStore.createBackup()` をそのまま差し替えるだけでは済まない。

## 推奨する段階移行

1. `MemoryStore` の直接DB呼び出しを `SqliteDatabaseAdapter` のような内部interfaceに寄せる。
2. 既定は `better-sqlite3` のままにして、全テストを維持する。
3. 別PRで `node:sqlite` adapter PoCを追加し、Node.js 22.16+ の環境だけで実行する専用テストを用意する。
4. PoCで `npm run test`、`npm run smoke:mcp`、`npm run smoke:practical`、backup/repair系テストを通す。
5. Node.js 24 LTS以降の安定度とWindows/Codex appでの実績を見て、既定backend変更を再判断する。

## 判断

#98の範囲では「移行可能性はあるが、即移行はしない」と判断する。次の実装Issueを切るなら、内容は「SQLite adapter interfaceを導入し、better-sqlite3 backendのまま既存挙動を保つ」がよい。

## 2026-06-27 update

- Issue #124 の作業では、`MemoryStore` に `SqliteDatabaseAdapter` / `SqliteAdapterFactory` の境界を導入した。
- 現時点の backend は引き続き `better-sqlite3` のみで、`node:sqlite` はまだ導入していない。
- readonly backup の open 経路も adapter factory を通す形にそろえた。
- 次に `node:sqlite` を試す場合は、別 Issue / 別 PR で PoC と専用検証を行う。既定 backend の切り替えはこの段階では行わない。
