# Memory Observatory 軽量化メモ

Issue: #130

## 結論

この段階では、見た目と機能を壊しにくい軽量化として、Observatory の描画 cadence をノード数・リンク数・密度・モードに応じて段階的に落とす方式を採用します。

採った方針は次です。

- low power mode 有効時だけ adaptive LOD を使う
- `full` / `balanced` / `reduced` の 3 段階で frame cadence を切り替える
- particle emission と object refresh cadence も同じ LOD に合わせて落とす
- low power mode 無効時は従来どおり滑らかさ優先の cadence を維持する

## 今回入れた軽量化

Observatory runtime で、次の pure rule を追加しました。

- 小規模グラフでは `full`
- 中規模、または dense graph では `balanced`
- 大規模グラフでは `reduced`

この LOD に応じて、次を切り替えます。

- `frameDelayMs`
- `objectRefreshEvery`
- `particleIntervalMs`

これにより、タブを開きっぱなしにした時でも、低負荷時は必要以上に frequent な object refresh を続けず、重いグラフでは glow / label 更新に伴う CPU 使用率を抑えます。

## 採用しなかった候補

### Web Worker

今回は未採用です。

- 現在の Observatory は ForceGraph3D runtime、tooltip、status bar、DOM side panel を密接に持っています。
- Worker へ切り出すには graph data の受け渡し境界を明確にし直す必要があり、描画負荷の削減以外の変更範囲が大きいです。
- まずは main thread 上で効く cadence 制御の方が、回帰リスクに対して効果が大きいと判断しました。

### OffscreenCanvas

今回は未採用です。

- browser / Codex in-app browser / local Chrome の差で挙動確認ポイントが増えます。
- ForceGraph3D bundle と three runtime を OffscreenCanvas 前提で再構成するより、先に LOD と refresh cadence を詰める方が安全です。

### aggressive visual degradation

今回は未採用です。

- 既にノード名は hover 時だけ表示しています。
- 常時 edge 非表示や glow 全停止は見た目の情報量を落としすぎるため、まず cadence 側で抑えました。

## 次段階でやるなら

1. visible node / visible link 数ベースで LOD を再計算する
2. hover / focus がない時だけ edge material 更新をさらに間引く
3. replay 中の event feed 更新を bucket 単位でさらに coarse にする
4. Worker / OffscreenCanvas は、専用 PoC issue に切って bundle 境界から見直す

## 現時点の判断

- 低リスクな軽量化は実装済み
- Worker / OffscreenCanvas は未採用だが、理由は文書化済み
- この issue の完了条件である「実装候補、または採用しない理由を docs に残す」は満たす
