# Changelog

このプロジェクトの主な変更を記録します。

## [0.1.0] - 2026-06-16

初回公開準備版です。AIエージェントが作業をまたいで使える、ローカル保存型の MCP メモリ基盤として使える状態を整えました。

### 追加

- MCP server として `write_memory`、`search_memory`、`read_memory`、`update_memory`、`forget_memory`、`memory_digest`、`memory_stats`、`audit_memory` を提供。
- `start_memory_session` で health、SQLite integrity、FTS、WAL、backup retention、関連メモリ、directive memory、メモリ鮮度、auto memory curation をまとめて確認。
- AGENTS.md に近い強い運用ルールを扱う directive memory を追加。`global` と `project` を分けて管理可能。
- `memory_auto_write = "off" | "review" | "safe"` による 3段階の auto memory curation を追加。
- `safe` mode では、高信頼、非重複、sourceRef良好、secret検出通過の候補だけ自動保存。
- SQLite FTS trigram と短語LIKE fallback により、Ollamaなしでも基本検索を利用可能。
- Ollama がある場合は embedding による semantic search と Dashboard のモデル状態確認に対応。
- Dashboard で health、メモリ統計、メモリ鮮度、保存候補、directive memory、backup、warnings、Ollama 状態を日本語で確認可能。
- Memory Observatory を追加。通常メモリ同士の関係、検索イベント由来の共起、embedding 類似度、忘却予測を読み取り専用の 3D graph として確認可能。
- `backup_memory`、`verify_backup`、`inspect_backup`、`plan_backup_retention`、`plan_backup_restore`、`repair_memory_index` を追加。
- Memory Observatory 3D runtime の vendored bundle について、再生成コマンド、checksum、third-party notice、CI検証を追加。
- public-readiness audit、SECURITY、CONTRIBUTING、Skill、AGENTS-memory-protocol を整備。

### 安全性

- MCP memory は README、実ファイル、git 履歴、ユーザーの最新指示の代替ではなく、補助情報として扱う設計。
- `propose_memory_update` と `propose_directive_update` により、保存前に重複、scope、sourceRef、リスクを確認可能。
- secret 検出、`externalAuthor` のレビュー誘導、audit log、backup verify、restore plan を追加。
- Dashboard はローカル運用を想定し、Host header 検証と警告表示を備える。
- Memory Observatory の `/api/graph` と Dashboard 表示は読み取り専用とし、通常メモリ本文や audit payload は返さない。

### ドキュメント

- README を日本語のまま、公開・ポートフォリオ向けに概要、3分セットアップ、Dashboard画像、安全設計、詳細docs導線が見える構成へ整理。
- `docs/assets/dashboard-overview.png` を追加。
- `docs/memory-observatory.md` と `vendor/observatory-3d.bundle.NOTICE.md` を追加。
- v0.1.0 GitHub Release draft 用の本文を追加。
