# 実証5：ステーブルコイン担保カードの利用枠を予算上限にする

状態：**準備済み・未実施**（2026-11-04 時点）

## 参照した公式ドキュメント（2026-11-04 確認）

| 用途 | サービス | 確認した公式情報 | 版・日付 |
|---|---|---|---|
| 担保で利用枠が決まるカード | **ether.fi Cash の Borrow モード**（実証4と同じアカウント・カード） | 担保と借入：https://help.ether.fi/en/articles/304388-how-does-collateral-and-borrowing-work （利用枠は Vault の資産額 × 資産ごとの LTV。USDC は Aave LendGateway で LTV 81%、Optimism 上）／利用上限：https://help.ether.fi/en/articles/330661-managing-your-card-and-vault-limits （上限を上げても残高・借入枠を超えては使えない）／拒否：https://help.ether.fi/en/articles/262393-why-did-my-transaction-get-declined （アプリの取引履歴に「Decline reason」が出る） | Aave の市場パラメータは 2026-08-27 更新（ページの記載） |
| エージェントが払う先 | 自社の Stripe（x402）の Payment Link（金額を買い手が決める、USD） | — | — |

想定：担保 $5 × LTV 81% = 利用枠 **$4.05**。

指示書との違い：なし。担保は実証4 で残った約 $5（Vault の USDC）。

## 手順

1. 人がカードを Borrow モードに切り替え、アプリに出る利用枠のスクリーンショットを渡す
2. 見込みの利用枠（担保 × USDC の LTV 81%）と、アプリの表示を突き合わせる
3. 人が Stripe ダッシュボードで金額を自由に入れられる Payment Link を作り、ether.fi のカードで **$1**（枠内）と **$4.50**（枠は超えるが Vault の残高は超えない額）を 1 回ずつ払い、結果のスクリーンショットを渡す
4. 拒否されたら、その文言を上の拒否理由・利用上限のページに照らして書く。Payment Link の売上は Stripe の手数料を引いて自社に戻り、返金はしない

## 結果

| 項目 | 値 |
|---|---|
| 実施日時 | |
| 担保額 | |
| 見込みの利用枠（担保 × 81%） | |
| アプリに出た利用枠 | |
| $1 の成否 | |
| $4.50 の拒否の有無と文言 | |
| 拒否理由の照合 | |

## 日本でこの種のカードをエージェントに使わせるときの規制上の論点（公開情報から）

1. **ステーブルコインの扱い（資金決済法）**：USDC は電子決済手段にあたり、日本の居住者向けに扱う業者は電子決済手段等取引業の登録が要る。金融庁の登録一覧（https://www.fsa.go.jp/menkyo/menkyoj/denshikessaisyudan.pdf 、令和7年3月4日現在の版）に ether.fi は無い（最新の一覧は https://www.fsa.go.jp/menkyo/menkyo.html から要確認）。無登録の業者は監督の対象外で、当局の保護を受けられない
2. **担保付きの後払い（割賦販売法・貸金業法）**：Borrow モードは、担保を入れたうえでの後払い・借入れにあたる。日本でクレジットカード（包括信用購入あっせん）を発行するには経済産業省への登録が要り（https://www.meti.go.jp/policy/economy/consumer/credit/index.html）、金銭の貸付けを業として行うには貸金業の登録が要る（https://www.fsa.go.jp/singi/singi_kinyu/seityousikin_wg/gijishidai/20260916/06.pdf）。海外の発行体が日本の居住者に提供する場合の扱いは論点になる
3. **エージェントに使わせること**：カードは本人確認（KYC）を通った個人に紐づき、エージェントの支払いは本人の利用として扱われる。不正利用の補償やチャージバックで「本人の操作か」が争点になりうる。担保で上限は決まるが、担保の値下がりで清算される（Borrow の利息・清算の仕組み、上記 ether.fi のページ）
