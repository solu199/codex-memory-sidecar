# メモリ評価ベンチ

Issue: #100

Codex Memory Sidecar は、メモリ機能の有用性を主張だけでなく再現可能な小さな評価でも確認します。最初の段階では、CIで重くなりすぎない smoke benchmark として `bench:recall` を用意しています。

## 実行方法

```powershell
npm run bench:recall
```

出力は JSON です。`ok: true` なら、CIで見る最低限の回帰検知を通過しています。

## 評価していること

- `keyword`: Ollamaなし相当の検索です。SQLite FTS trigram / porter と RRF、LIKE fallback に加えて、近接リランキングと短い英語 typo 補正の安全実装が fixture を壊していないかを見ます。
- `semantic`: Ollamaあり相当の検索です。CIでは外部モデルを呼ばず、決定的な疑似embeddingを使って semantic search の経路を通します。
- `recallAt3`: 期待したメモリが上位3件に入った割合です。
- `precisionAt3`: 上位3件のうち期待メモリだった割合です。
- `sourceRefQuality`: fixtureの `sourceRef` が `pr:#123`、`issue:#123`、`git:<hash>`、docs path、named evaluation id などの追跡可能な形式かを見ます。
- `duplicateSuppression`: 似た内容を `propose_memory_update` にかけた時、重複候補として検出できるかを見ます。

## CIでの読み方

このベンチは「LongMemEval風の小さな固定fixture」です。実運用の品質を完全に証明するものではありませんが、検索改善、sourceRef判定、重複抑制の変更で明らかな退行が起きた時に検知する目的で使います。Issue #129 の段階では、近接語順と短い typo query を fixture に追加し、過剰な曖昧一致で precision を落とさずに改善できているかを重点的に見ます。

閾値は現在次の通りです。

- `recallAt3 >= 0.85`
- `precisionAt3 >= 0.4`
- `sourceRefQuality >= 1`
- `duplicateSuppression = true`

Ollama実体を使った追加検証は `npm run smoke:ollama` で行います。`bench:recall` はCI向けに、ネットワークやローカルモデルに依存しない形を優先しています。
