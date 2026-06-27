# Codex plugin packaging 調査

Issue: #125

## 結論

現時点では、このリポジトリを直ちに Codex plugin 配布へ切り替えるより、今の手動セットアップ経路を一次導線として残すのが安全です。

理由は次の通りです。

- 現在このリポジトリで継続検証しているのは、`dist/src/index.js` を使う MCP 登録、Skill 配置、カスタム指示、SessionStart hook です。
- Codex plugin は配布体験をまとめられますが、plugin marketplace、plugin install cache、plugin-bundled hooks の trust review まで含めると、利用者にとって確認ポイントが増えます。
- 特に hook は install されただけでは自動実行されず、現行仕様では non-managed hook として review / trust が必要です。

したがって、この issue の時点では「採用可能な構成案とリスクを文書化する」までを完了とし、plugin-first の README には切り替えません。

## 公式仕様で確認したこと

OpenAI Developers の Codex docs では、plugin は `.codex-plugin/plugin.json` を必須 manifest とするフォルダ配布単位です。plugin root には `skills/`、`hooks/`、`.mcp.json`、`.app.json`、`assets/` を同梱できます。

また、plugin を Codex に見せる導線として marketplace があり、repo-scoped なら `$REPO_ROOT/.agents/plugins/marketplace.json`、personal なら `~/.agents/plugins/marketplace.json` が使えます。local plugin も install 時には `~/.codex/plugins/cache/...` 配下へ展開され、そこから読み込まれます。

hook については、plugin に `hooks/hooks.json` を同梱でき、manifest の `hooks` で上書きもできます。ただし plugin-bundled hook は managed hook ではなく、ユーザーが review / trust するまで実行されません。

## この repo で採るならこうなる構成案

最小構成は次です。

```text
codex-memory-sidecar-plugin/
  .codex-plugin/
    plugin.json
  skills/
    codex-memory-sidecar/
      SKILL.md
      agents/openai.yaml
  hooks/
    hooks.json
  .mcp.json
  assets/
```

### 1. plugin.json

- `name`, `version`, `description`
- `skills: "./skills/"`
- `mcpServers: "./.mcp.json"`
- `hooks: "./hooks/hooks.json"` または default path 利用
- install surface 用の `interface.displayName`, `shortDescription`, `defaultPrompt`

### 2. .mcp.json

- `codex-memory-sidecar` の stdio 起動
- `command: "node"`
- `args: ["./dist/src/index.js"]` のような相対指定ではなく、plugin 配布形態に合わせた解決方法の確認が必要
- DB path と Dashboard port をどこまで plugin 側の既定値に持たせるか要検討

### 3. hooks/hooks.json

- SessionStart hook を plugin に同梱すること自体は可能
- ただし trust review が入るので、README には「install 後に `/hooks` で review / trust が必要」と明記する必要がある

### 4. marketplace

- repo 内で試すなら `.agents/plugins/marketplace.json`
- 個人環境で配るだけなら `~/.agents/plugins/marketplace.json`
- この repo では、plugin 本体 repo と marketplace repo を分ける必然性はまだ低い

## この repo で今すぐ採用しない理由

### 1. テスト導線がまだ plugin-first ではない

現行の smoke / README / practical verification は、MCP server の直接起動と Skill 配置を前提にしています。plugin install cache 経由の実運用検証はまだありません。

### 2. hook trust review が onboarding friction になる

SessionStart hook を便利にまとめられる反面、「plugin を入れたらすぐ動く」と README に書けません。レビューと trust が必要なため、個人用ツールより一段説明が増えます。

### 3. Dashboard / DB path の責務分離が曖昧

このツールは local DB path、Dashboard 自動起動、MCP env var を強く使います。plugin に閉じるのか、引き続き repo / user config 側で持つのかを先に整理しないと、plugin 化でかえって設定が見えにくくなります。

## README に残すべき扱い

- 「現在の継続検証対象は manual MCP registration + Skill + hook adapter」であること
- plugin packaging は調査済みだが、現時点の一次導線ではないこと
- 将来 plugin 配布へ進む場合は、marketplace、plugin cache、hook trust review を含めて別 issue / PR で扱うこと

## 次に進めるなら

1. 最小 plugin skeleton を別ディレクトリで作る
2. `.mcp.json` から sidecar を起動する PoC を作る
3. `hooks/hooks.json` を bundle し、trust review 後に SessionStart が走るかを smoke にする
4. plugin install 後の `start_memory_session` / `health_check` / Dashboard 起動を通してから README の一次導線変更を検討する

## 現時点の判断

- plugin packaging は「採用可能だが未採用」
- この issue では調査完了
- 実装するなら別 issue / 別 PR で扱う
