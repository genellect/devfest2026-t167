# Google Drive・Classroom連携

2026-11-08の依頼に基づく追加機能。FirebaseのGoogle本人認証と独自Cookieを維持し、通常ログインではDrive/Classroomの追加権限を要求しない。本人が機能を使う時だけ既存Googleプロバイダーによる再認証・追加同意を求める。FastAPIや別の認証基盤は導入しない。

## Classroom

ホームのメニュー「Classroom連携」から `/classroom` を開く。`classroom.courses.readonly`で`teacherId=me`と`studentId=me`を別々に全ページ取得し、ACTIVEなコースを列挙する。役割はコース単位で教師/生徒を表示し、複数コースは選択できる。名簿を開くときだけ`classroom.rosters.readonly`を追加し、APIで教師所属を再検証する。名簿は表示名とGoogle側IDだけを返し、保存やDiscussの自動入会には使わない。課題・成績・コース自体は変更しない。

セッション作成は、手順書どおり招待済み教員（teacher claim）に限る。Classroomに紐付ける場合は、APIがGoogleへ問い合わせてそのコースでも教師であることを検証し、`classroomCourseId/classroomCourseName`を保存する。Classroom連携によってアプリ全体の教員権限や学校管理者権限を付与しない。

作成したセッションは作成者をmembers.role=hostにし、以降は既存のセッション内認可を使う。同じ人が別コースで生徒でもよく、別のセッションではParticipantになれる。コース教師であるだけでは他人が作ったセッションの管理/分析権限を持たない。

コースのセッション一覧は最大100件を対象に最小の名称/テーマ/状態/参加導線だけを返す。未参加者が開けるのは準備中のセッションだけで、開始後・終了後は既存の有効な所属者に限定する。コード/QRによる参加は既存の招待経路として維持する。コースの名簿を全員自動参加させたり、学校ドメインから全校のコースを列挙したりしない。コース所属なし・連携拒否・学校のアプリ制限・接続障害でも共通ホームを使える。

## Drive

実セッションのHostの準備中画面、またはHost設定の「共有資料」から公式Google Pickerを開く。選択したファイルだけにアクセスできる`drive.file`を使い、全Drive読み取りは要求しない。PDF・Docs・Slides・Sheetsに対応し、Googleネイティブ文書はDrive APIでPDFに変換する。

追加前に「PDFの写しを、このセッションの参加者へ共有する」をHostが確認する。Driveのpermissionsは変更せず、任意の人へ公開しない。ダウンロード不可・ゴミ箱の資料・未対応形式・PDFとして不正な応答は拒否する。内容をGeminiへ自動送信しない。選択時点の写しなので元資料の編集は自動反映しない。同じ資料の更新は共有を解除してから再追加する。

1資料4MiB、5資料かつ合計8MiBまで。既存Firestoreのセッション配下に資料メタデータ`materials/{sha256(fileId)}`と512KiB単位の`chunks/{番号}`をトランザクションで保存する。新しいStorage/IAM/公開URLを増やさないためのMVPの小容量制約であり、大きな資料向けのストレージ設計の代わりではない。Googleアクセストークンや元のDrive URL/IDは保存しない。

参加者は実セッションの下部「共有資料」から一覧・PDF閲覧を開く。PDF.jsでページをcanvasへ描画し、前/次のページ操作を提供する。描画用worker・CMap・標準フォント・WASMは固定依存から生成して同一サイトで配信し、第三者CDNへ資料を渡さない。isEvalSupportedをfalseにし、描画は最大400万ピクセルに制限する。補助テキストを読み上げ用に付け、PDFの別タブ表示も提供する。PDFはBearer＋Cookie付きの認可済みAPIからBlobで取得し、閉じるとObject URLを破棄する。資料を開いても録音処理をアンマウント・再取得しない。資料一覧は表示中15秒間隔で更新し、取得失敗時は古い一覧を隠す。セッションで配布したPDFのため、メンバーのGoogle Drive権限は必要ない。

APIが毎回所属・除外状態を検査する。Hostだけ追加/解除でき、未参加者・他セッション・除外メンバーは閲覧できない。共有解除は写しと全チャンクを削除する。FireStore/Storageの既存クライアントRulesは全拒否を維持する。PDFはメタデータと分離し、既存ライブ配信へ混ぜない。既にダウンロードされたPDFの回収はできない。セッション終了で資料は自動削除しないため、不要な資料はHostが共有解除する。

開発専用`/student/session`と`/host/mock`は以前のサンプル表示のまま。実資料の経路は`/rooms/{id}`であり、サンプルを実データとして補わない。

## 認証と設定

ブラウザでGoogleアクセストークンをこのタブのメモリだけに保持する。localStorage・Cookie・Firestore・ログへ保存せず、再読み込み/アカウント変更で再接続する。リフレッシュトークンを収集しない。APIへは`x-google-access-token`ヘッダーで送り、Google UserInfoのsubとFirebase IDトークンのgoogle.com identitiesを照合する。異なるGoogleアカウントのトークンを使えない。Google側の期限切れは`409 google_reconnect`とし、Discussの認証セッション失効とは区別する。

Firebase Authenticationの既存Google OAuthクライアントを再利用する。Classroom用の新しいクライアント秘密鍵は不要。Google Cloud側でDrive API、Google Picker API、Classroom APIの有効化、OAuth同意画面のスコープ/テストユーザー/公開状態、必要なOAuth審査、学校側のアプリ許可を確認する。Firebaseの認証ドメインも確認する。

PickerはFirebase公開Web設定のapiKeyとappId内のプロジェクト番号を既定で使う。専用の公開キーを使う場合は`NEXT_PUBLIC_GOOGLE_PICKER_API_KEY`、番号を明示する場合は`NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER`をビルド前に設定する。Picker用APIキーは対象サイトのHTTPリファラーと必要APIへ制限し、既存Firebaseキーの制限を無条件に広げない。アクセストークン・OAuthクライアント秘密鍵・サービスアカウント鍵はこれらの設定に入れない。

エミュレータは本物のGoogle OAuthを行えないため、連携ボタンはその旨を表示する。通常のMVP機能はそのまま動作する。Google Cloud設定や本番への反映はコードの実装とは別で、既存手順書に従う。実接続の準備・操作手順は[実Google検証](real-google-testing.md)を参照。APIの有効化とコードの配備は分け、IAM変更や本番配備を実行しない。

## APIと検証

全エンドポイントはGoogle本人認証と独自セッションを必須とする。Google参照は固定ホストのみ、タイムアウトと応答サイズ制限を使い、Googleのエラー本文は出さない。

- `GET /integrations/classroom/courses`: 本人のコース/役割。
- `GET /integrations/classroom/courses/{id}/roster`: そのコースの教師のみ、追加権限が必要。
- `GET /integrations/classroom/courses/{id}/discussions`: そのコースの所属者のみ、最小の参加導線。
- `POST /rooms`: `classroomCourseId`指定時もアプリの招待済み教員であることを必須とし、Google側の教師所属も再検証。
- `GET /rooms/{id}/materials`・`GET /rooms/{id}/materials/{file}/content`: 現在も有効なセッションメンバー。
- `POST /rooms/{id}/materials`: Hostのみ、`fileId`と`shareCopy:true`。同一ファイルの再送は重複させない。
- `POST /rooms/{id}/materials/{file}/remove`: Hostのみ、PDFと全チャンクを削除。

単体テストではGoogle HTTP応答とFirebase再認証を代替し、追加スコープ・ページング・PDF変換・サイズ/形式/ダウンロード禁止・Google失効を検査する。エミュレータ結合テストではGoogleクライアントだけを代替し、実際のCookie/IDトークン/Firestoreを用いて本人不一致・コースごとの役割・招待権限とコース教師の両方を満たすHost・名簿・非参加/他セッション/Participant操作禁止・資料保存/取得/解除を検査する。これらを実Google同意や実学校アカウントの検証と同一視しない。

公式仕様：

- [Firebase Google認証・追加スコープ](https://firebase.google.com/docs/auth/web/google-signin)
- [ClassroomコースとteacherId/studentId](https://developers.google.com/workspace/classroom/reference/rest/v1/courses/list)
- [Classroomの権限](https://developers.google.com/workspace/classroom/guides/auth)
- [Google Picker](https://developers.google.com/workspace/drive/picker/guides/overview)
- [DriveのダウンロードとPDF変換](https://developers.google.com/workspace/drive/api/guides/manage-downloads)

PDF.jsの公開アセットは`npm ci`のpostinstall、`npm run dev`のpredev、`npm run build`のprebuildで`web/public/pdfjs-{version}/`へ生成する。生成物はgitignoreし、package.json/lockfileと生成スクリプトを管理する。Node.jsの既存対応範囲を保つ5.4.624を固定する。依存更新時はnpm ci・開発依存を含むnpm audit・全check・スマホでの実PDF描画を確認する。

ブラウザ別の追加検査には`web/playwright.workspace.config.ts`を使う。専用ポート/DBのエミュレータを用意し、checkと同じ環境変数・同じ最終ビルドで`npm --prefix web run e2e -- --config=playwright.workspace.config.ts`を実行する。Chromiumのスマホ/PCとWebKitのスマホ/タブレットで、Classroom未連携時の通常参加と、API応答を代替した実セッション内PDFの実描画/ページ送りを確認する。実GoogleのOAuthや実機の検証ではない。

## 検証の区分

本ブランチでは、清掃後のMVP画面に接続し直して検査する。過去の別ブランチの結果は本ブランチの合格として扱わない。実Google同意・実Driveファイル・学校の名簿・学校設定・OAuth審査はエミュレータ試験では検証できない。

Classroom上で教師でも、アプリ側のteacher claimを自動付与しない。セッション作成は既存の招待済み教員に限り、Classroomに紐付ける場合はそのコースでも教師であることを検証する。コースごとの教師・生徒判定と、独立したセッションのHost・Participantは分離する。

この作業ブランチの最終結果は[音声処理・分析・保存期限](backend-processing.md#ローカル検証結果2026-11-08)に記載。GoogleのHTTP応答は代替しており、実アカウントの接続成功とは区別する。
