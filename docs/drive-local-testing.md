# Googleドライブの実接続とローカル検証

ホストがセッションを作成したあとの準備画面に「共有資料」を表示する。議論開始後は設定内から使う。「選んだ資料のPDFの写しを、このセッションの参加者へ共有する」を確認して「ドライブから追加」を押すと、同じGoogle本人への追加同意と公式Pickerを開く。PDF・Google Docs・Slides・Sheetsを選べる。参加者は議論画面の「共有資料」からPDFを閲覧する。共有解除はHostだけが行える。

元のDriveファイルの共有権限は変更しない。選択時点のPDFの写しをセッション配下へ保存し、元の編集は自動反映しない。本文をAIへ自動送信しない。1件4MiB、最大5件・合計8MiB。Googleトークンはタブのメモリと単一リクエストのヘッダーでだけ使い、Cookie・localStorage・DB・URL・ログに保存しない。

## 通常の共通ローカル環境

`scripts/dev.sh serve`はAuth/Firestoreエミュレータを使う。本物のGoogle OAuthは行えない。「ドライブから追加」は実接続の設定が必要な旨を案内し、模擬ログインを実Google本人として扱わない。資料の追加・閲覧・解除と認可は、Google HTTP/OAuthだけを置き換えた自動試験で検証する。

## 実際のGoogleドライブを使う準備

既存Firebaseプロジェクトの公開Web設定と、APIが実Google IDトークンの失効確認をできる権限が必要。サービスアカウントの鍵やOAuthクライアント秘密鍵をブラウザへ渡さない。

1. 対象プロジェクトでDrive APIとGoogle Picker APIが有効であることを確認する。既存Firebase GoogleプロバイダーのOAuth同意画面・テストユーザー・学校のアプリ制限を確認する。追加する権限は選択したファイルだけの`drive.file`。本変更ではクラウド側の設定を変更しない。
2. ローカルWebの起動環境へ、`NEXT_PUBLIC_USE_EMULATORS=0`と`NEXT_PUBLIC_FIREBASE_API_KEY`・`NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`・`NEXT_PUBLIC_FIREBASE_PROJECT_ID`・`NEXT_PUBLIC_FIREBASE_APP_ID`を設定する。Picker専用の公開キーは`NEXT_PUBLIC_GOOGLE_PICKER_API_KEY`、プロジェクト番号は`NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER`で上書きできる。既存Firebaseキーの利用制限を無条件に広げない。
3. `API_ORIGIN`を同じ変更を適用したAPIへ向ける。ローカルAPIなら`FIREBASE_AUTH_EMULATOR_HOST`を指定せず、`GOOGLE_CLOUD_PROJECT`を対象Firebaseプロジェクトへ合わせる。既存ADC等の認証情報でFirebase Authenticationの失効検査ができる必要がある。Firestoreだけエミュレータを使う場合は`FIRESTORE_EMULATOR_HOST`を明示し、そのプロジェクトとデータが本番から隔離されていることを確認する。Geminiは`GEMINI_MOCK=1`を維持できる。通常の`dev.sh serve`はこれらを模擬認証用に上書きするので、実Google用の起動には流用しない。
4. ブラウザは承認済みのHTTPSオリジン、またはMacのlocalhostを使う。現在の`http://192.168.10.117:17000`は実Google OAuthには使えない。iPad/iPhoneで実接続するには、端末が信頼するHTTPS接続とGoogle側へのオリジン登録が必要。HTTPで動く共通プレビューを無断で置き換えない。
5. 招待された教員でGoogleログインし、架空のセッションを作成する。個人情報を含まない試験用PDFまたはDocsを選択→共有→別の参加者で閲覧→Hostで共有解除→参加者で取得不可、の順に確かめる。学校側の拒否・追加同意キャンセルでも通常のセッションは使えることを確認する。

## API契約

既存のGET資料一覧・PDF取得は`material-routes.ts`が引き続き担当する。新しい書き込みだけ`drive-material-routes.ts`へ登録する。

| API | 条件 | 入力/動作 |
|---|---|---|
| `POST /rooms/{id}/materials` | 有効なIDトークンとCookie、Host、Google本人一致、未終了 | `{fileId, shareCopy:true}`、`x-google-access-token`。PDF取得後にもHost/終了/件数/容量を再検査しトランザクション保存 |
| `POST /rooms/{id}/materials/{sha256}/remove` | 有効なIDトークンとCookie、Host | メタデータと全チャンクを同じトランザクションで削除 |
| `GET /rooms/{id}/materials` | 現在有効なメンバー | 一覧のみ。トークン・PDF本文・元のDrive IDを返さない |
| `GET /rooms/{id}/materials/{sha256}/content` | 現在有効なメンバー | 認可済みPDF。取得中の共有解除と所属解除も再検査 |

保存形式は既存の` sessions/{roomId}/materials/{sha256(fileId)}`と`chunks/{index}`。`workspace.ts`の既存Google HTTPアダプターを再利用する。Classroomのルートはこの変更では登録しない。

公式仕様：[Google Picker](https://developers.google.com/workspace/drive/picker/guides/web-picker)、[Firebaseの追加スコープ](https://firebase.google.com/docs/auth/web/google-signin)、[Google OAuthのオリジン条件](https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow)。
