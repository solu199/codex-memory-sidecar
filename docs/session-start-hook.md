# Codex SessionStart hook

Issue: #97

Codex Memory Sidecar は、Codex Hooks の `SessionStart` で短い追加コンテキストを返す hook adapter を提供します。目的は、チャット開始時や resume 時に directive memory と最近の通常メモリを軽く思い出せるようにし、gateway skill や `AGENTS.md` がまだ効いていない軽い会話での取りこぼしを補うことです。

この hook は `start_memory_session` の代替ではありません。重要な作業判断、`health_check`、memory status、Dashboard / backup / repair 確認では、必ず明示的な `start_memory_session` を先に呼びます。

## 何を返すか

`dist/src/hook-session-start.js` は標準入力で Codex hook payload を受け取り、成功時に次の JSON を標準出力へ返します。

```json
{
  "continue": true,
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "Codex Memory Sidecar SessionStart context: ..."
  }
}
```

Codex Hooks では、この `additionalContext` が追加コンテキストとしてセッションに渡されます。内容は約 2KB を目安に絞り込み、次のような短い状態だけを返します。

- DB health と active memory 件数
- global / project directive memory の要点
- project scope の最近メモリ
- 「memory は参考情報であり、ユーザー指示・README/docs・実ファイル・git を優先する」という優先順位

## 何をしないか

hook 経路では auto-write を発火させません。`start_memory_session` も呼ばないため、起動監査イベントや `memory_auto_write = "safe"` の自動保存は発生しません。

DB が未初期化、設定が読めない、SQLite を開けないなどの失敗時も、hook 自体は `exit 0` で終了して Codex のセッション起動を妨げません。

## 設置場所

推奨は次の 2 つです。

1. プロジェクトローカルの `.codex/hooks.json`
2. plugin 同梱の `hooks/hooks.json`

プロジェクトローカルでは絶対パス指定が最も確実です。plugin 同梱版はこの repo に `hooks/hooks.json` として含めていますが、plugin-bundled hook は non-managed hook なので、install 後に review / trust が必要です。

## hooks.json 例

プロジェクトローカルの `.codex/hooks.json` 例です。

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "node \"C:/path/to/codex-memory-sidecar/dist/src/hook-session-start.js\"",
            "statusMessage": "Loading Codex Memory Sidecar context"
          }
        ]
      }
    ]
  }
}
```

plugin 同梱版では `hooks/hooks.json` から `node "./dist/src/hook-session-start.js"` を参照します。install 後は `/hooks` で command の解決先を確認し、必要なら cache 展開先に合わせて見直してください。

`CODEX_MEMORY_DB` を明示したい場合は、hook command 側の環境変数または `config/memory-sidecar.toml` で DB path を揃えます。

## 確認

```powershell
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run smoke:hook
```

`smoke:hook` は directive memory と最近メモリが短い `additionalContext` に入ること、hook 経路で auto-write が発火しないことを確認します。
