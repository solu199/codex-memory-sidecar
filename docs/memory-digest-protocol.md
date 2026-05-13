# memory_digest 運用プロトコル

`memory_digest` は、作業前に必要そうなローカル記憶だけを短く集めるための入口です。現在のユーザー指示や実ファイルより優先するものではありません。

## 使うタイミング

- 複数ファイルにまたがる変更を始める前。
- 過去の設計判断やユーザーの好みが影響しそうなとき。
- Codex/AGENTS 系の作業プロトコルを適用する前。
- 実用テスト、バックアップ、dashboard、MCP 登録など、環境依存の手順を扱うとき。

使わなくてよい場面:

- 単純な typo 修正。
- 直近の会話だけで十分に判断できる小さな回答。
- ユーザーが明示的にメモリ参照を望まないとき。

## 推奨入力

```json
{
  "taskDescription": "今回の作業を短く具体的に書く",
  "projectPath": "対象リポジトリの絶対パス",
  "maxTokens": 800
}
```

`projectPath` は scope 判定に使われますが、embedding query や audit payload には混ぜません。人間が読める固定名で運用したい場合だけ `projectScope` を使います。

## 読み方

- digest は「候補」です。古い、曖昧、現在のファイルと矛盾する可能性があります。
- 重要な判断は、必ず現在のファイル、テスト、ユーザーの最新指示で確認します。
- memory id や summary を根拠として使う場合は、必要に応じて `read_memory` や `audit_memory` で出所を確認します。

## 保存するもの

作業後、次回にも役立つ情報だけ `write_memory` / `update_memory` を検討します。

- プロジェクト固有の運用ルール。
- 繰り返し発生した不具合と原因。
- ユーザーが明示した好みや制約。
- 通った検証コマンド。
- MCP 登録、Ollama、backup、dashboard などの環境注意点。

保存しないもの:

- token、API key、password、個人情報の詳細。
- 一時的な作業ログ。
- 実ファイルや git 履歴で十分に追える内容。
- すぐ失効する状態。

## scope の扱い

- 既定では同じ project scope と `global` だけを参照します。
- 横断確認が必要なときだけ `includeCrossProject: true` を使います。
- `projectPath` を使うとローカルパスは hash 化されます。
- scope をまたいだ検索結果を使った場合は、その理由を作業メモや PR に残します。

## 最小手順

1. 作業前に `memory_digest(taskDescription, projectPath)` を呼ぶ。
2. 返った digest を現在の指示とファイルで検証する。
3. 不足があれば `search_memory` で追加検索する。
4. 作業後、次回に役立つ知見だけ保存を検討する。
5. 保存した場合は、必要に応じて `audit_memory` でイベントを確認する。
