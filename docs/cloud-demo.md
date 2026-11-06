# クラウドでのデモ準備と確認

> 2026-11-06 MVP仕様変更：全員Googleログイン・共通ホーム。固定の教師/生徒ロールとteacher claimによるHost制限を廃止し、議論のmembers.roleでHost/Participantを判定します。ログイン上限は全員1台です。新仕様・API・移行条件は [MVPロール設計](mvp-roles.md) を参照。以下の旧仕様と相違する場合は新仕様を適用します。


デモ本体は既存のFirebase App Hosting → 同一オリジンの/api → Cloud Run → Vertex AI/Firestoreで動かす。利用者の端末にMac・ローカルサーバー・検証用証明書は不要。クラウドサービスや別プロジェクトは追加しない。

このPRを出すことと、反映後のクラウド動作確認は分ける。現在のpreviewは画面だけを差し替え、API・Auth・Firestoreは本番と共有する。新しいAPI・Rulesの動作確認には、同じ版をそろえた反映が必要。previewの成功だけで実AIの動作確認済みとはしない。

## MVPをローカルで通して確認する

Google Docs「MVPフロー」に合わせ、全員Googleログイン → 共通ホーム →「参加する」からHost/Guestを選ぶ。Hostは名前・テーマ・時間・グループを設定して作成し、Guestはコード/QR・表示名・初回音声登録・待機へ進む。共有端末では全員を1人ずつ登録する。Host開始後に同意を確認してグループ1台で録音し、時間切れまたはHost終了から、録音送信・分析・公開結果・ホームへ進む。

```bash
bash scripts/dev.sh setup
T167_TEST_PORT_OFFSET=27700 bash scripts/dev.sh serve
# http://localhost:30700 を別々のブラウザープロファイルで開く。
# 標準の全検査：
T167_TEST_PORT_OFFSET=27700 bash scripts/dev.sh check
```

ローカルの標準起動はAuth/FirestoreエミュレータとGemini・話者モデルのモック。画面にもモックであることを表示する。あらかじめある100001ではなく、Hostが新しく作成したセッションのコードで現MVPを確認する。実モデル・実Gemini・実クラウドの確認とは分けて記録する。

録音の継続はHostのセッション開始・終了に従う。グループ集計の配信が遅れても、MVPの議論中に自動停止・送信しない。終了後は送信完了とHostの「分析済み」表示まで確認する。

## 反映前の準備（管理者が実施）

1. README・CONTRIBUTINGとGoogle Docs正本の「PRの確認から本番反映までの手順」に従い、依存するPR・CI・変更内容を確認する。
2. 本番反映の前にYuto Matsuiの承諾と、Rules/infra変更に必要なもう1人のレビューを得る。承諾前はマージ・auto-merge・手動デプロイ・IAM変更をしない。
3. プロジェクト、Cloud Run/Firestoreの東京、App Hostingの台湾、Vertexのglobal、モデルと6つのGitHub Variablesを既存のinfra/env.shと照合する。WIFを利用し、アプリにサービスアカウント鍵を配置しない。
4. 管理者がinfra/setup-project.shでCloud Run実行用api-runtimeの権限を確認する。失効確認を行うverifyIdToken(token, true)はFirebase認証バックエンドから利用者を読むため、roles/firebaseauth.viewerが必要。APIにはユーザーやclaimを変更する権限を付けない。
5. Firebase AuthenticationのGoogleプロバイダーと本番・previewの承認済みドメインを確認する。全員Googleログイン必須。固定ロール登録は行わず、作成・参加時に役割を付与する。

Firebase認証の読み取り権限は[公式の権限一覧](https://docs.cloud.google.com/iam/docs/roles-permissions/firebaseauth)、失効確認の通信は[公式のセッション管理](https://firebase.google.com/docs/auth/admin/manage-sessions)を参照。Google Docs/写しに残る匿名参加の旧方針との差異はbackend-contract.mdに記載している。正本の変更は担当者が関係する変更と同時に行う。

## MVPのHost権限

教師claimの付与は不要。全員Googleでログインし、セッション作成者にだけHost権限をバックエンドで付与する。学校管理者claimは学校ポリシー管理専用。

## 承諾後の反映とデモ確認

1. 担当者が手順に従ってPRをマージする。既存deployがFirestore Rules/索引 → Cloud Run API → App Hostingの順に同じコミットを反映する。インフラとRulesを変えるPRは、もう1人のレビューも必要。
2. Actionsのdeploy成功とコミット/APIリビジョンを確認する。Firestoreの必要な索引が利用可能になるまで待つ。
3. 本番URLをPCとiPad/iPhoneのSafariで開く。MacのローカルURLは使わない。/api/healthがok=true、gemini=geminiであることを確かめる。この応答は設定確認だけで生成成功の証明ではない。
4. 教師1人と生徒3人がそれぞれGoogleログインしてホームを開く。教師が試験用の部屋を作り、生徒がホームからコードを入力して参加し、架空の事前意見を出す。他人や教師へ非公開意見の本文が見えないことを確かめる。
5. グループ別の議論・録音・終了・結論提出・結果表示を通す。AIを使うと利用料が発生する。実Geminiの結果と、ブラウザの購読による更新を画面で確認する。
6. 通信切断/復旧、録音の再送、権限拒否、誤ったコードも確認する。iPadのマイク許可・音声形式・30分録音・ロック/バックグラウンドは実機項目として別に記録する。
7. 確認したPR・コミット、PC/スマホでの結果、未確認事項をPRコメントへ記録する。エミュレータや表示シミュレーションの結果を実API・実機の成功と報告しない。

今回の実装作業では上の管理者コマンド、IAM変更、実AI呼び出し、マージ、デプロイは実行していない。Docker/Cloud Runでのコンテナ実行と実サービスの正の検証も、承諾後に行う。

## セッション管理版の反映前確認

この版ではFirestore直接購読をAPI配信へ移すため、通常の旧画面だけのPRプレビューでは動かない。独自セッションAPI/Rules/Webをそろえたローカルエミュレータで確認する。既存の自動プレビューは画面だけが更新される。API未反映中のプレビューはログイン・セッション機能の成功確認として扱わず、同一SHAでのAPI/Rules/Web反映をリリース条件とする。

承認後、メンテナンス時間に利用を停止し、同一SHAのAPI/Rules/Webを反映する。配備前に管理者がFirebase Storage管理APIと配備主体の一覧/Rules権限を確認し、`PROJECT_ID=<対象プロジェクト> node infra/deploy-rules.mjs --plan`で登録バケットを読み取り確認する。deployは同じ入口の`--apply`でFirestore/Storage Rulesを配備する。登録がないと確認できた場合だけStorageを省略し、新規バケットを作らない。一覧エラーでは停止する。バケット公開IAMと既存署名URLも確認する。TTLのplanは`bash infra/setup-session-security.sh --plan`、適用は承認後の`--apply`。監査閲覧IAMは運用担当に限定する。学校管理者は信頼された管理側がschoolAdmin/schoolIdを設定する。詳細は[認証とセッション](auth-sessions.md)。

## 本番APIの話者モデル同梱

`api/Dockerfile`はルートcontextからAPIと`speech/`をビルドし、Python仮想環境と固定版推論ライブラリ・チェックサム検証済みモデルを同梱する。起動時にモデルを取得しない。`/app/api/dist/server.js`から既存の相対パスで`/app/speech/worker.py`を呼び、非rootで動かす。API専用Docker ignoreの許可リストは別PRのデモ用コンテナに影響しない。

ワークフローには2 CPU・2GiB・同時8リクエスト・最小0/最大2台を指定する。これは推論を同梱するための初期設定であり、実クラウド性能や費用の保証ではない。管理者は配備前に予算・クォータ・Artifact Registry/外部モデル配布先への接続を確認し、承認された非本番環境でイメージのビルドと話者モデルの起動、6グループの同時処理を確認する。Docker未導入の端末上での構成検査を、コンテナ実行成功とは扱わない。

## PR用の実Geminiデモ（本番には反映しない）

統合PR #35のMVPを土台に、画面・API・実音声モデルを同梱した`demo/Dockerfile`をCloud Buildで準備する。既存`web-preview`の**通常トラフィックを変更しないタグ付きリビジョン**へデプロイし、専用タグURLで操作する。本番`web`・`api`、main、Firestoreの本番ルート、既存Rulesは変更しない。共有プレビューの通常URLも旧リビジョンのままにする。

デモの保存先は`demoEnvironments/{DEMO_ID}/`以下。利用者・ログイン・参加コード・議論・音声登録をすべて分離し、全環境collectionGroup検索を禁止する。本人の議論一覧は`users/{uid}/discussions`から所属を再検査して取得する。Firebase Authenticationは既存プロジェクトのGoogle認証を使い、デモ用タグホストだけを承認済みドメインへ追加する。

実行用は既存Computeサービスアカウントを新規デモリビジョンだけに指定する。既存のEditor権限を使用し、IAM権限の追加や鍵の配布はしない。これは本番向けの最小権限設計ではなく、デモに限定する。専用SA/DBや公開サービスの新設には管理者権限が必要。

```bash
# 変更対象・no-traffic・タグ・環境変数を表示するだけ
DEMO_ID=pr35 DEMO_IMAGE=asia-northeast1-docker.pkg.dev/devfest2026-t167/app/pr35-demo:v1 bash demo/deploy.sh --plan
# 非本番デモへの反映が承認されている場合だけ実行
DEMO_ID=pr35 DEMO_IMAGE=asia-northeast1-docker.pkg.dev/devfest2026-t167/app/pr35-demo:v1 bash demo/deploy.sh --apply
```

アプリのGoogleログインと独自セッション認可は通常どおり必要。エミュレータログインや認証を迂回するデモユーザーは公開しない。Geminiは既存global/モデル/LOWを維持し、モックにフォールバックしない。短い音声は実測秒数を伝え、結果の総時間を実測へそろえ、録音外の時刻を根拠として表示しない。

`demo/start.sh`はcleanupを設置してからAPIのhealth正常応答を待ち、その後だけNextの公開ポートを開く。接続失敗/5xxは回数上限まで待ち、起動失敗では停止する。回帰テストは実通信をモック化しており、実コンテナのコールドスタート成功を示さない。`demo/`も構築変更として別メンバーレビューを要求する。

本番以外への実AI接続は今回の依頼で許可された範囲。上の旧手順の「実AI未実行」「IAM未確認」は過去の準備段階の記録であり、このデモの検証結果とは区別する。マージ・本番デプロイは別途承諾が必要。

タグ作成後、`DEMO_ID=pr35 node demo/authorize-domain.mjs`でCloud Runが返した実タグホストを検証し、Firebaseの承認済みドメインへ追加する。既存ドメインはすべて保持する。資格情報はローカルADCまたはCloud SDKの標準認証を使い、コードやコンテナへコピーしない。デモURLは通常のCloud RunタグURLであり、既存App Hostingの通常URLとは別。

公開人声の実Gemini試験は`T167_REAL_GEMINI=1`を付けた専用Playwright構成で実行する。既存Vertexプロジェクト/global/モデルを指定し、録音をAPIからVertexへ送信して、送信完了・Geminiによる推定・結果本文の表示まで待つ。ローカル実AI試験ではFirebase/Authだけエミュレータとし、クラウドデモのGoogle認証・Firestore試験とは分けて記録する。

既存`web-preview`には公開Invokerの許可がないため、タグURLへの匿名アクセスは403になる。IAMは変更せず、プロジェクトの呼出権限を持つGoogleアカウントで公式プロキシを起動して`http://localhost:36000`を開く。これはクラウドの同じタグリビジョンへ認証して接続するだけで、API/Firestore/Geminiはクラウド上で動く。ローカルポートは自分の端末だけに公開する。アプリ内では別途指定のGoogleアカウントでログインする。第三者に共有できる公開URLの提供には、管理者による専用非本番サービスのInvoker設定が必要。

```bash
gcloud run services proxy web-preview --tag=pr35-demo --project=devfest2026-t167 --region=asia-east1 --port=36000
```
