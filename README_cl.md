# カップ・ロール

球を転がしてテーブルの端のカップに入れる、2人用のオンライン対戦ゲーム。ブラウザだけで遊べる（スマホ対応）。

## 手元で動かす

```bash
npm install
npm start
```

http://localhost:3000 を開く。「この端末で2人で遊ぶ」ならサーバーとの通信なしで遊べる。

## 友人とオンラインで遊ぶ

サーバーをインターネットに公開する必要がある。方法は2つ。

### A. 一時的に公開する（すぐ試したいとき）

自分のPCで `npm start` を実行したまま、cloudflared のクイックトンネルを使う。

```bash
cloudflared tunnel --url http://localhost:3000
```

表示された `https://xxxx.trycloudflare.com` を開き、部屋を作って招待リンクを友人に送る。PCを閉じると遊べなくなる。

### B. 常設する（Render の例）

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/SotaUeta/cup-roll)

上のボタンから、`render.yaml` の設定のまま1クリックでデプロイできる。手動で設定する場合は次のとおり。

1. このフォルダを GitHub リポジトリに push する
2. Render で New → Web Service → そのリポジトリを選ぶ
3. Build Command: `npm install`、Start Command: `npm start`
4. 発行された URL を開く

WebSocket が使えて Node.js が動くサービスなら、Render 以外（Fly.io、Railway など）でも動く。
Render の無料プランは、しばらくアクセスがないとスリープし、次に開いたとき起動まで数十秒かかる。料金や条件は変わることがあるので各サービスで確認すること。

## ルール

- テーブルはカップ側に傾いていて、球は必ず坂を転がり落ちる
- 交互に1球ずつ。カップの方へスワイプ（PCはドラッグ）した向きに転がる。強さは関係ない
- 投げる位置は中央から少し外れた所。プレイヤー1は左、プレイヤー2は右
- カップは 2・1・X・5・X・1・2。X は0点。1つのカップに入るのは3球まで。満杯のカップに来た球は弾かれる
- 横のコップは1人18個（左がプレイヤー1、右がプレイヤー2）。取った点の数だけ投げる側から消える
- コップが消えた所には壁がなく、球が台の横から落ちることがある
- 先に自分のコップを全部消した方の勝ち。点の入るカップが全部埋まったら、残りが少ない方の勝ち。先攻は1試合ごとに交代

## 構成

| ファイル | 役割 |
|---|---|
| `server_cl.js` | 静的ファイル配信と WebSocket。部屋の管理と物理計算はサーバー側で行い、結果を両者に配る |
| `public/game_cl.js` | 物理演算とルール（サーバーとブラウザで共用） |
| `public/client_cl.js` | 描画・操作・通信 |
| `public/index_cl.html`, `public/style_cl.css` | 画面 |

調整用の値（横のコップの数、カップの容量、傾き、投げる位置など）は `public/game_cl.js` の先頭の `C` にまとめてある。

部屋の情報はサーバーのメモリ上にだけあるので、サーバーを再起動すると進行中の試合は消える。
