# 技術的な中期改善ロードマップ

この文書は、公開後レビューと `codex-memory-sidecar-ecosystem-notes.md` で出た改善案を、実装順とIssueへ分解したものです。

今回のPRでは、まず #95 の lint / formatter 導入を品質ゲートとして整えます。検索・hook・DB移行・評価基盤のような影響範囲が広い改善は、個別IssueでTDDと検証を分けます。

## 0. 品質ゲート: lint / formatter

- Issue: #95
- 目的: TypeScript とdocsの変更品質を、`npm run lint` と `npm run format:check` で継続的に確認できるようにする。
- 今回やること:
  - ESLint と Prettier を導入する
  - `lint` / `format:check` / `format` scripts を追加する
  - tooling設定の存在をテストで固定する
- 注意:
  - 初回導入時はPrettier基準線を作るため差分が大きくなる
  - 以後のPRではformat差分を小さく保つ

## 1. 検索品質: porter + trigram + RRF

- Issue: #96
- 目的: Ollamaなしでも、英語技術用語、日本語、日英混在メモリをより安定して検索できるようにする。
- 背景:
  - 現在は日本語向けに SQLite FTS5 trigram を使っている
  - 英語の活用形や技術語には porter tokenizer の索引が効く可能性がある
- 方針:
  - trigram索引を維持したまま、porter索引を追加する
  - 2つの検索結果を Reciprocal Rank Fusion で統合する
  - 日本語・英語・日英混在のfixtureを先に作る
  - 近接リランキングとtypo補正は、RRF導入後に別段階で検討する

## 2. Codex SessionStart hook adapter

- Issue: #97
- 目的: 新しいCodexセッション開始時に、directive memory と関連メモリ要約を自動でdeveloper contextへ注入できるようにする。
- 公式仕様として確認したこと:
  - Codex Hooks は `hooks.json` と `config.toml` の inline `[hooks]` から読み込める
  - `SessionStart` は command hook を実行できる
  - hook は plugin に同梱できる
  - project-local hook は project `.codex/` layer がtrustedなときだけ読み込まれる
  - 非managed hook はtrust reviewが必要
- 方針:
  - MCP serverとは別の `hook-session-start` entrypoint を作る
  - hook経路では auto-write を発火させない
  - 出力は約2KBに抑え、directive とメモリsummary + IDを中心にする
  - 失敗時は exit 0 でCodexセッション開始を妨げない
  - `smoke:hook` を追加する
- 注意:
  - Codex alphaではhook回帰が起きる可能性がある
  - AGENTS.md / カスタム指示ブートストラップはフォールバックとして残す

## 3. node:sqlite 移行調査

- Issue: #98
- 目的: `better-sqlite3` のネイティブアドオン依存を減らせるか検証する。
- 方針:
  - 現在使っている `better-sqlite3` APIを棚卸しする
  - Node.js 22系の `node:sqlite` で WAL、busy_timeout、FTS5、backup運用が満たせるか確認する
  - すぐ置換せず、互換レイヤーまたはPoCを先に作る
- 判断基準:
  - Windows / Codex app / CIで安定すること
  - migrationとbackupの安全性を落とさないこと

## 4. bi-temporal memory invalidation

- Issue: #99
- 目的: 古いメモリを単に忘れるのではなく、「いつから無効になったか」「何により無効化されたか」を追跡する。
- 方針:
  - `valid_from`
  - `invalidated_at`
  - `invalidated_by_ref`
  - これらを最小スキーマとして検討する
- 注意:
  - 既存の `superseded` / `forgotten` と役割を整理する
  - search、digest、Dashboard、audit表示を同時に検討する

## 5. recency scoring と progressive disclosure

- 関連Issue: #96 / #99
- 目的: 検索結果の鮮度と表示粒度を改善する。
- 方針:
  - score式へrecency項を明示的に入れる
  - 検索結果のデフォルトはsummary + ID + sourceRef中心にする
  - full content や embedding は明示要求時だけ返す

## 6. recall benchmark CI

- Issue: #100
- 目的: メモリ検索や重複抑制の改善を、再現可能な小さな評価で示せるようにする。
- 方針:
  - 小さなLongMemEval風fixtureを作る
  - Ollamaなし検索とOllamaあり検索を分ける
  - recall、sourceRef品質、duplicate抑制を測る
  - CIで重すぎない smoke benchmark から始める

## 7. Codex plugin packaging

- 関連Issue: #97
- 目的: 将来的に MCP server、Skill、hook をまとめて配布しやすくする。
- 方針:
  - まず手動 `hooks.json` と MCP登録で検証する
  - その後 `.codex-plugin/plugin.json` と plugin-bundled hook を検討する
  - hook trust review の体験をREADMEに明記する

## 参考

- Codex Hooks: https://developers.openai.com/codex/hooks
- Codex Config Reference: https://developers.openai.com/codex/config-reference
- context-mode: https://github.com/mksglu/context-mode
- Graphiti: https://github.com/getzep/graphiti
- Mem0: https://github.com/mem0ai/mem0
