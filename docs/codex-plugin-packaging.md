# Codex plugin packaging

Issue: #125

## 現在の位置づけ

この repo には、Codex Memory Sidecar を Codex plugin 配布単位としてまとめるための local plugin skeleton を同梱しています。現時点の一次導線は repo 直下セットアップのままですが、plugin-first に切り替えるための最小構成はすでに揃っています。

含まれているもの:

- `.codex-plugin/plugin.json`
- `.mcp.json`
- `hooks/hooks.json`
- `skills/codex-memory-sidecar/`
- `assets/dashboard-overview.png`

方針としては「custom instructions で補う」のではなく、plugin に gateway skill、MCP 設定、SessionStart hook、表示 assets をまとめます。

## 同梱ファイルの役割

### `.codex-plugin/plugin.json`

plugin manifest です。Codex 側の install surface で使う表示名、説明、screenshots、skill / MCP の参照先をまとめます。

### `.mcp.json`

`codex-memory-sidecar` の stdio 起動設定です。repo 直下では `node` と `./dist/src/index.js` を参照し、`cwd: "."` を前提にします。

### `hooks/hooks.json`

`SessionStart` 向けの軽量 hook 設定です。startup / resume / clear / compact を契機に短い追加コンテキストを返します。

### `skills/codex-memory-sidecar/`

入口の広い gateway skill と、`references/` / `commands/` に分けた運用知識を含みます。plugin 化しても behavior の中心はここです。

## trust と path の注意点

plugin-bundled hook は managed hook ではありません。install 後に review / trust が必要です。したがって、「plugin を入れたら即 hook が動く」とは README に書けません。

また、plugin install 後は通常 `~/.codex/plugins/cache/...` 配下へ展開されます。次の 3 点は install 後に確認します。

1. `.mcp.json` の `./dist/src/index.js` が cache 展開先から正しく解決されるか
2. `hooks/hooks.json` の `./dist/src/hook-session-start.js` が `/hooks` 上で正しく見えるか
3. plugin install 後の `health_check`、`start_memory_session`、Dashboard 起動が通るか

この repo は local plugin skeleton を提供しますが、Codex 側の install / trust / cache path はユーザー環境依存です。そこは README ではなく運用確認として扱います。

## marketplace と install cache

plugin を Codex に見せる導線としては、repo-scoped の `.agents/plugins/marketplace.json` か、個人環境の `~/.agents/plugins/marketplace.json` が使えます。install 済み plugin は `~/.codex/plugins/cache/...` に展開されます。

この repo では marketplace repo を分ける前提にはしていません。まずは repo 自体を plugin source として扱える形に揃えています。

## README での扱い

README には次のスタンスを残します。

- 継続検証している主要対象は Codex app
- custom instructions は標準導線にしない
- gateway skill と `AGENTS.md` が基本入口
- `SessionStart` hook は startup / resume の補助であり、明示的な `start_memory_session` の代替ではない
- plugin skeleton は repo に同梱済みだが、trust review と install 後確認は別途必要

## 残るギャップ

まだ自動化していない確認があります。

1. marketplace から install して cache 展開後に動くかの end-to-end smoke
2. plugin install 後の hook command 解決先が環境差で崩れないか
3. Codex UI 上での install / trust 手順をどこまで README に書くか

したがって、現時点の判断は「local plugin skeleton は正式に repo に含めるが、plugin install 自体の最終導線は Codex 側確認込みで運用する」です。
