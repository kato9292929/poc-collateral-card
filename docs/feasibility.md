# 実証6 実装前の確認

## CC の環境で確かめたこと（2026-11-15）

| 項目 | 結果 |
|---|---|
| payjp.js（`https://js.pay.jp/v2/pay.js`）をヘッドレスの Chromium で、`http://localhost` のページから読み込めるか | 読み込めた。カードの入力欄は `element_iframe` の中の `input[name=cardnumber]`・`exp-date`・`cvc`。公開鍵の確認用の `payjp_api_iframe` と `api.pay.jp/v1/js/apitunnel.html` も読み込まれる |
| 実在しない公開鍵で `createToken` を呼んだとき | `401 auth_error`「pk_test_…0000 は不正なAPIキーです。」が返る（payjp.js から API まで通信は届く） |

## GitHub Actions で確かめること（`scripts/feasibility-6.ts`、本番の実行の前に毎回動く）

1. seller A の公開鍵だけで、payjp.js をヘッドレスブラウザで動かしてテストカードのトークンを作れるか。作れなければ実行を止める
2. 公開鍵での `POST /v1/tokens` を、ブラウザを通さずに呼べるか（可否だけ記録。実装では使わない）
3. seller A の公開鍵で作ったトークンが、seller B のアカウントの与信で拒否されるか

結果は `docs/runs/<日時>-feasibility-6.json`。
