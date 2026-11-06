# 同じWi-FiのiPadで画面とAPIを確認する

GitHub mainを基点にした画面と、ローカルの改善版APIをまとめて確認する。PR作成・push・本番デプロイは不要。

```bash
T167_TEST_PORT_OFFSET=10000 bash scripts/dev.sh serve --mode mock --ipad
```

MacのWi-Fi（en0）のIPv4を使い、起動ログにiPad用HTTPS URLと初回設定用HTTP URLを表示する。標準の画面13000に加え、HTTPS=13443、初回設定=13080を使用する。ポートを変える場合はT167_IPAD_HTTPS_PORT/T167_IPAD_SETUP_PORT、Wi-Fiインターフェースが異なる場合はT167_IPAD_HOSTを指定する。既存のプレビューは停止せず、使われていないポートを選ぶ。

## iPadでの操作

1. Macと同じWi-Fiに接続し、Safariで初回設定用URLを開く。
2. 過去の録音プレビューの検証用CAが有効なら再利用する。すでに信頼済みの場合、HTTPSの確認画面をそのまま開ける。
3. 証明書が未設定なら、設定ページから取得して「設定→一般→VPNとデバイス管理」でインストールし、「一般→情報→証明書信頼設定」でこの検証用CAを信頼する。MacのキーチェーンやiPadの設定はスクリプトでは変更しない。
4. 確認画面のテスト用教師・生徒でログインする。参加コードDEMO01の部屋を用意する。
5. 教師と生徒を別々に試す場合はログアウトして切り替える。2台で確認する場合はMacを教師、iPadを生徒にすると進行を見比べられる。
6. 教師の部屋作成→生徒の参加→事前意見→議論と録音→結論の一文→結果を確認する。MacとiPadで同じ部屋の状態が更新されることも確認する。

証明書の管理が学校の端末ポリシーで制限されている場合は、管理者への確認が必要。検証後、不要になった検証用プロファイルは削除できる。

## 接続の仕組み

iPad自身の127.0.0.1へ接続しないよう、画面・/api・AuthのクライアントAPI・FirestoreのWebChannelを、同じHTTPSオリジンからMac内へ転送する。FirestoreはHTTPSとlong pollingを使用する。認証とFirestoreをLANに直接公開せず、エミュレータの管理APIと任意URLへの転送も許可しない。

ローカルHTTPのlocalhostアクセスでは従来の直接接続を維持する。NEXT_PUBLIC_EMULATOR_PROXYは--ipad起動時だけ有効にし、本番やcloudモードでは使用しない。GitHub版の認可・Rulesはそのまま適用する。

## 検証の範囲

mockではAPI自体は実際のExpressサーバーが動き、認証/DBはエミュレータ、AIはモック。実Geminiは、手順書のGoogle Cloud認証を設定したうえで `--mode vertex --ipad` として明示的に切り替える。cloudモードのLANプレビューはこのコマンドの対象外。

HTTPSページでマイクの利用可能な状態を用意するが、iPad Safariのマイク許可・30分録音・画面ロック・バックグラウンド移行は実機で確認する。Mac側のブラウザ検査を実機検証済みとは報告しない。
