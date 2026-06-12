# Codex SessionStart hook

Issue: #97

Codex Memory Sidecar は、Codex Hooks の `SessionStart` から短い追加コンテキストを返す hook adapter を提供します。目的は、チャット開始時に directive memory と最近の通常メモリを軽く思い出せるようにし、`start_memory_session` の呼び忘れを補助することです。

この hook は `start_memory_session` の代替ではありません。`AGENTS.md`、Skill、カスタム指示のフォールバックは残してください。

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

Codex Hooks では、この `additionalContext` が追加の developer context としてセッションに注入されます。内容は約 2KB に抑え、主に次の情報だけを入れます。

- DB health と active memory 件数
- global / project directive memory
- project scope の最近の通常メモリ
- 「memory は補助情報であり、ユーザー指示、実ファイル、docs、git 履歴で裏取りする」という優先順位

## 書き込みをしない

hook 経路では auto-write を発火させません。`start_memory_session` も呼ばないため、起動監査イベントや `memory_auto_write = "safe"` の自動保存は発生しません。

DB が存在しない、設定が読めない、SQLite を開けないなどの失敗時は、何も出力せず `exit 0` で終了します。セッション起動をブロックしないためです。

## hooks.json 例

Codex の公式 Hooks 仕様では、`SessionStart` hook の stdout に含まれる `hookSpecificOutput.additionalContext` を追加コンテキストとして扱えます。プロジェクトローカルの `.codex/hooks.json` を使う場合、そのプロジェクトを trusted にし、必要に応じて `/hooks` で hook command を確認してください。

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume",
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

`CODEX_MEMORY_DB` を環境変数に指定している環境では、その DB を読みます。未指定なら `config/memory-sidecar.toml` または `data/memory.sqlite` を使います。

## 確認

```powershell
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run smoke:hook
```

`smoke:hook` は directive memory と通常メモリが短い `additionalContext` に入ること、また hook 実行で memory 件数が増えないことを確認します。
