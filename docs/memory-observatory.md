# Memory Observatory

Memory Observatory は、Codex Memory Sidecar に保存された通常メモリの関係を 3D グラフで俯瞰する Dashboard ビューです。

目的は、メモリ本文を読むことではなく、どの記憶が近く、どの記憶が最近参照され、どの領域が薄くなっているかを安全に把握することです。

## 目的

- 通常メモリの全体像を Dashboard で短時間に確認する。
- embedding 類似度、検索履歴由来の共起、layer、tag、project scope のまとまりを分けて表示する。
- `ライブ`、`リプレイ`、`探索` の3モードで、現在状態、最近の参照イベント、探索用の表示を切り替える。
- 3D グラフ上で、回転、ズーム、パン、ノードドラッグ、フォーカス、Ctrl+ホバーの要約表示を使って関係を探索する。
- メモリ本文や audit payload をブラウザへ出さず、公開前・実用運用時の安全性を保つ。
- Dashboard の表示や再読み込みだけで、メモリやイベントが増える feedback loop を作らない。

## Dashboard 構成

Dashboard は左ナビを持つローカルWebアプリとして動きます。

- `観測`: Memory Observatory。3D グラフ上に通常メモリの関係を表示します。
- `状態`: health、DB、embedding、Ollama モデル状態を表示します。
- `メモリ`: memory stats、memory freshness、auto memory curation、最近のメモリを表示します。
- `Directive`: active / disabled directive memory を監査用に表示します。
- `保守`: backup、repair、warning action を表示します。
- `イベント`: 最近の audit event を表示します。
- `設定`: dashboard schema version などの表示方針を表示します。

観測ビューの右サイドバーでは、想起フィード、忘却予測、クラスタ凡例、統計、タイトル表示、similarity / hebbian edge、自動回転、忘却の霧の切り替えを確認できます。

## API

Dashboard server は読み取り専用の `/api/graph` を返します。

- `nodes`: 通常メモリの安全な要約ビューです。`id`、`label`、`layer`、`status`、`summary`、`tags`、`projectScope`、`sourceType`、`sourceRef`、`importance`、`confidence`、`activation`、`retrievability7d`、座標、更新日時を含みます。
- `clusters`: layer、tag、project scope 由来のまとまりです。graph 表示と右ペインの把握に使います。
- `events`: graph 用に安全化した最近のイベントです。`id`、`eventType`、`memoryIds`、`createdAt` だけを返し、payload は含めません。
- `edges.similarity`: embedding があるメモリ同士の cosine similarity です。
- `edges.hebbian`: `search_memory` などで同時に参照されたメモリの共起関係です。14日 decay をかけ、最近の共起ほど重く扱います。
- `privacy`: `contentIncluded: false`、`eventPayloadIncluded: false` を返し、本文と audit payload を含めないことを明示します。

`/api/graph` は `MemoryStore` を読むだけで、メモリ、イベント、audit を書き込みません。Dashboard の再読み込みだけで検索履歴が増えたり、auto memory curation が発火したりしない設計です。

## 表示

3D グラフでは、点を通常メモリ、線を関係として描画します。

- 点の色は layer / cluster を表します。
- 点の大きさと奥行きは現在の活性度を表します。
- よく想起される記憶ほど手前に浮かび、忘れられつつある記憶は霧の奥へ沈みます。
- 細い線は similarity、信号のように流れる線は検索履歴由来の共起を表します。

操作は以下の通りです。

- ドラッグで回転、ホイールでズーム、右ドラッグでパンできます。
- ノードをドラッグすると物理シミュレーションが加熱され、離すと自然配置へ戻ります。
- ノードをクリックするとフォーカスし、無関係なノードとエッジを追いやすくします。
- Ctrl+ホバーで通常メモリの要約を確認できます。
- `自動回転` と `忘却の霧` は右サイドバーから切り替えられます。

モードは以下の通りです。

- `ライブ`: 現在のメモリ状態と最近イベントを表示します。
- `リプレイ`: タイムラインをスクラブし、参照履歴を時間軸で追いやすくします。
- `探索`: 検索やトグルでメモリの関係を調べやすくします。

## プライバシー境界

Memory Observatory は、通常メモリ本文を表示しません。Dashboard に表示するのは要約とメタデータだけです。

Directive memory は強い運用ルールを監査する目的で本文を表示しますが、通常メモリ本文と audit payload は `/api/status` と `/api/graph` のどちらにも含めません。

この境界により、Dashboard を開いたまま画面共有する場合でも、通常メモリの細かな本文や検索イベントの payload を不用意に露出しにくくしています。

## 今後の改善候補

- layer / project scope / tag の複合フィルタ。
- 「このメモリで分かること / 分からないこと」の表示。
- bi-temporal invalidation と連動した古い記憶の弱表示。
- 選択ノードの詳細インスペクタと、関連する sourceRef / PR / commit への導線。
