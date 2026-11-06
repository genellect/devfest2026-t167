# クラウドでのデモ準備と確認

> 2026-11-06 MVP仕様変更：全員Googleログイン・共通ホーム。固定の教師/生徒ロールとteacher claimによるHost制限を廃止し、議論のmembers.roleでHost/Participantを判定します。ログイン上限は全員1台です。新仕様・API・移行条件は [MVPロール設計](mvp-roles.md) を参照。以下の旧仕様と相違する場合は新仕様を適用します。


デモ本体は既存のFirebase App Hosting → 同一オリジンの/api → Cloud Run → Vertex AI/Firestoreで動かす。利用者の端末にMac・ローカルサーバー・検証用証明書は不要。クラウドサービスや別プロジェクトは追加しない。

このPRを出すことと、反映後のクラウド動作確認は分ける。現在のpreviewは画面だけを差し替え、API・Auth・Firestoreは本番と共有する。新しいAPI・Rulesの動作確認には、同じ版をそろえた反映が必要。previewの成功だけで実AIの動作確認済みとはしない。

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

承認後、メンテナンス時間に利用を停止し、同一SHAのAPI/Rules/Webを反映する。Storageバケットが存在する場合は`firebase.json`のstorage.rulesを承認された管理者が`npm --prefix firebase run fb -- deploy --only storage --project <対象プロジェクト>`で適用する。バケット公開IAMと既存署名URLも確認する。TTLのplanは`bash infra/setup-session-security.sh --plan`、適用は承認後の`--apply`。監査閲覧IAMは運用担当に限定する。学校管理者は信頼された管理側がschoolAdmin/schoolIdを設定する。詳細は[認証とセッション](auth-sessions.md)。
