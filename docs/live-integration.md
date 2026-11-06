# GitHub画面とAPIのローカル統合

GitHub mainのNext.js画面、Express API、Firestoreの購読をそのまま使う。品質改善（Google必須・教師claim・録音の再送と検証）を同じローカルcheckoutで組み合わせる。PR作成・push・クラウドへの配備は起動や検査の前提にしない。

## 接続モード

```bash
bash scripts/dev.sh setup
T167_TEST_PORT_OFFSET=10000 bash scripts/dev.sh serve --mode mock
T167_TEST_PORT_OFFSET=10000 bash scripts/dev.sh serve --mode vertex
T167_TEST_PORT_OFFSET=10000 bash scripts/dev.sh serve --mode cloud
```

同時に起動するのは1つだけ。オフセット10000では画面が http://localhost:13000 、APIが18081。別の作業で使われていればオフセットを変える。Ctrl+Cでその起動の子プロセスだけを止める。

| モード | Googleログイン・DB | AI | 用途 |
|---|---|---|---|
| mock（既定） | Auth/Firestoreエミュレータ | モック | 自動テスト・画面確認 |
| vertex | Auth/Firestoreエミュレータ | 実Vertex AI | 本番の部屋を変更せず実AIを確認 |
| cloud | 実Firebase | 実Vertex AI | 試験用の部屋で実接続を確認 |

`GEMINI_MOCK=0 bash scripts/dev.sh serve` はvertexと同じ。接続先・モデルはinfra/env.shを使用し、モデルや思考レベルを変更しない。実接続を指定して認証に失敗した場合、モックに切り替えず、サーバーやエミュレータを起動する前に停止する。cloudはseedを実行せず、エミュレータの環境変数も解除する。

## Google Cloud認証

正本の「認証情報の引き継ぎ」に従い、次のいずれかを実行環境に用意する。

- 手元のADC：プロジェクトへの権限を持つメンバーが `gcloud auth application-default login` を実施する。
- `GOOGLE_APPLICATION_CREDENTIALS`：認証ファイルのパスを指定する。認証ファイルをリポジトリに置かない。
- AI環境の `GCP_SA_KEY`：サービスアカウントJSONを環境変数として設定する。APIとVertex SDKへメモリ内で渡し、ファイル・ログに書き出さない。

GitHub ActionsのWIFはGitHubの実行環境で使うもので、MacのADCを自動作成しない。GitHub/Google Driveへの接続もGoogle Cloudの実行権限の代わりにはならない。サービスアカウントのキーを新規発行したり、既存の権限を変更したりする処理はこの起動コマンドに含めない。

認証があることとVertexを利用できることは区別する。実生成の確認は次の明示コマンドで行う。

```bash
bash scripts/dev.sh verify-live
```

架空の意見のテキスト分析と、1秒の無音PCMの音声分析だけを実行する。実APIの利用料が発生する。DBの作成・更新はしない。結果は.gitignore対象の `.local-data/live-verification.json` に成功/失敗・所要時間だけを記録し、音声・生成本文・認証情報を記録しない。認証に失敗すれば実生成を開始しない。

## ローカルから実Google認証・Firestoreを使う

Firebaseコンソールの既存Webアプリの公開設定を `web/.env.local` に設定する。サービスアカウントの鍵はここに書かない。

```dotenv
NEXT_PUBLIC_FIREBASE_API_KEY=FirebaseのWeb設定のapiKey
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=FirebaseのWeb設定のauthDomain
NEXT_PUBLIC_FIREBASE_APP_ID=FirebaseのWeb設定のappId
```

projectIdは起動時にinfra/env.shのPROJECT_IDに合わせる。Firebase AuthenticationのGoogleプロバイダーとlocalhostの承認済みドメインを確認する。教師操作は管理者が設定したteacher=trueのclaimが必要で、画面の役割選択から権限を付けない。claimはサインイン中のトークンにも反映する必要がある（再ログイン）。

App Hostingの自動Firebase設定は維持する。上記の公開設定を明示した場合だけ、それを優先してローカル初期化する。設定が一部だけなら不足している項目名を表示する。

## 確認する流れ

教師ログイン → 部屋作成 → 生徒ログイン → 参加 → グループ選択 → 非公開意見 → 議論と録音 → 結論の一文 → グループ別結果、の順に確認する。

UIは同じオリジンの/apiを呼び、Next.jsがローカルAPIへ転送する。APIはIDトークンを検証し、結果は既存の rooms/{部屋}/results/group-{番号} と flow-g{番号} に保存する。Firestoreの購読で画面に反映する。

401ではトークンを更新して1回だけ再送する。通信断・5xx・時間切れでは自動再送しない。録音は同じBlobを保持し、利用者の再送操作とAPIの指紋・受領結果で二重分析を防ぐ。送信中も離脱確認の対象に含める。一般APIは30秒、録音APIは210秒でクライアント側の待機を打ち切る。

既存本番のRulesとローカル改善版のRulesが同じとは限らない。cloudで使う試験用の部屋には架空データだけを使い、改善Rulesの実環境への適用や教師claimの付与は担当者の運用で行う。このコマンドでは本番設定を変更しない。

15秒分割・IndexedDBの独立試作は保持する。今回統合するGitHub版は録音終了後の一括送信API。分割送信の本体・保存場所・完了判定の統合は次工程であり、任意の音声チャンクを単純連結すれば再生できるとは仮定しない。

iPad Safariのマイク権限、HTTPS、30分録音、画面ロック・バックグラウンド、実Google認証は実機で別途確認する。localhostエミュレータへの接続を、同じWi-FiのiPadで検証済みとは扱わない。
