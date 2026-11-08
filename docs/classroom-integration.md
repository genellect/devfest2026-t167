# Classroom読み取り連携

既存のGoogle本人認証、HttpOnlyアプリセッション、Express/TypeScript、Firestoreを維持する。Docs正本「MVPフロー」のClassroom情報取得・属性管理を、今回合意した読み取り専用の範囲で実装する。課題・成績・保護者情報の取得やClassroomへの投稿・編集は行わない。

## 使い方

ホームの「Classroomと連携」、または設定の「Classroom連携」から追加許可を行う。ログインと同じGoogleアカウントの有効なクラスだけを表示する。教員/生徒はクラスごとの役割であり、アプリのteacher claim・members.roleには自動転記しない。

- 教員：有効なGoogleログイン・アプリセッションに加え、選択したクラスでの教員所属をGoogleへ確認する。「ホストする」のクラス選択で連携し、クラス名をセッションに反映する。待機画面で名簿・参加状況を明示的に取得/更新する。
- 生徒：ホームのクラス選択から開催中・準備中の議論を確認する。未参加者は準備中だけ参加できる。参加後は既存の音声登録・事前意見・待機へ進む。Classroom名簿だけでアプリユーザー・議論メンバーを作成しない。
- 参加状況はGoogleアカウント単位で、更新日時を表示する。共有端末の匿名参加者一人ひとりを出席として確定しない。
- コード/QRは維持する。Classroom付きの議論の新規参加には、同じタブでClassroomを連携したうえで所属検査を通す。Classroomなしの通常の議論は追加許可なしで参加できる。
- 更新は手動。背景ポーリングやトークン更新で最終利用日時を延長しない。所属の削除・アーカイブ・権限拒否は次回の取得・新規参加で検知する。既存の議論メンバーの自動削除はしない。

## OAuthと保存

通常ログインにClassroom権限を一括追加しない。クラス一覧は `classroom.courses.readonly`、名簿を開くときだけ `classroom.rosters.readonly`を追加する。既存のFirebase Googleプロバイダーで追加同意/再認証し、ブラウザのメモリだけに短時間保持する。localStorage、IndexedDB、Cookie、Firestoreにはアクセストークンやrefresh tokenを保存しない。再読み込み・失効・アカウント切替後は再接続する。

APIには `x-google-access-token` ヘッダーで送り、固定のGoogle UserInfoエンドポイントで得たsubをFirebase IDトークンの署名済みgoogle.com識別子と照合する。別アカウントのOAuthトークン・クライアントの名前/ロール指定では所属を偽装できない。URL、ログ、エラー本文にはトークンやGoogle応答本文を出さない。Google通信にはタイムアウト・レスポンス容量・ページ数の上限を設ける。実行中のGoogle連携も、APIごとに独自アプリセッションが有効であることを検査する。

Firestore保存先：

- `sessions/{roomId}`：`classroomCourseId`、`classroomCourseName`、任意の`classroomCourseSection`、表示用`className`（既存40文字制限）。識別には変更される名前でなくGoogleのIDを使う。
- `sessions/{roomId}/members/{uid}`：新規参加時に検証済みの`classroomUserId`。教員の名簿照合だけに使い、リアルタイム配信から除く。
- `users/{uid}/discussions/{roomId}`：既存の参加履歴。履歴APIにもクラス名を返す。

名簿全体・追加OAuthトークンは保存しない。Firestore/Storageの直接アクセス拒否Rulesを維持する。APIによる認可を増設し、Rulesの変更は不要。

## API

すべてGoogle IDトークン＋有効な独自Cookieを検証する。連携APIは利用者ごと60回/分に制限する。

| API | 追加検査・応答 |
|---|---|
| `GET /integrations/classroom/courses` | 本人のACTIVEなクラス、クラスごとの教員/生徒、`syncedAt` |
| `GET /integrations/classroom/courses/{id}/roster` | 当該クラスの教員のみ。表示名・Google ID・同期時刻 |
| `GET /integrations/classroom/courses/{id}/discussions` | 当該クラスの所属を再検証。未参加者には準備中だけ、参加済みには有効な進行中も返す。除外済み・終了・失効を除く。コード・名簿・分析は返さない |
| `POST /rooms` | 任意`classroomCourseId`。有効なGoogleログイン・アプリセッションと当該クラスの教員所属。クラス名はGoogle側の値を使用 |
| `POST /rooms/join` | 従来の`{code}`、または`{classroomRoomId}`。後者はClassroom付きだけ。新規参加では所属・本人を再検証し、既存トランザクションでグループ・履歴と同時登録 |
| `GET /rooms/{id}/classroom/roster` | 当該議論の有効なHostかつ現在のClassroom教員だけ。名簿と参加済み/未参加を返す |
| `GET /discussions` | 既存の有効な議論所属の検査を維持し、`className`を追加 |

追加APIではバックグラウンドのGETで利用期限を延長しない。参加/作成は既存の成功操作による最終利用日時更新を維持する。Googleトークン期限切れは`409 google_reconnect`、本人不一致・未所属・学校の制限は`403`、通信/不正応答は安全な`502`。失敗を空一覧・連携成功として表示しない。

クラスごとの議論は最大100件を取得し、101件以上は明示的な上限エラーを返す。将来、運用件数に応じてページングまたは開催中専用の索引を追加する。クラス全件の常時同期・全名簿のバックグラウンド保持は行わない。

## ローカル検証

実Googleを呼ばない専用モックは明示フラグを付けて使う。

```bash
CLASSROOM_MOCK=1 NEXT_PUBLIC_CLASSROOM_MOCK=1 T167_TEST_PORT_OFFSET=31000 bash scripts/dev.sh check
CLASSROOM_MOCK=1 NEXT_PUBLIC_CLASSROOM_MOCK=1 T167_TEST_PORT_OFFSET=35000 bash scripts/dev.sh serve
```

モックはGeminiモック＋localhostのAuth/Firestore両エミュレータの場合だけサーバーに注入する。ブラウザも`NEXT_PUBLIC_USE_EMULATORS=1`との同時指定が必要。画面には「Classroom モック」を表示する。サンプルクラス・名簿だけを使い、Classroomや学校の実データは読み書きしない。通常の認証・Cookie・部屋の認可は省略しない。

スマホChromium・PC Chromium・タブレットWebKitの追加検証は、同じモック用最終ビルドと専用エミュレータで `npm --prefix web run e2e -- --config=playwright.classroom.config.ts` を実行する。自動検査は実Googleの同意画面やiPadOS実機の検査ではない。

## 実接続前の管理者確認

Firebaseの既存Google OAuthクライアントを再利用する。Classroom用の秘密鍵をコードに追加しない。管理者がClassroom APIの有効化、OAuth同意画面のスコープ・対象ユーザー・公開状態、必要な審査、認証ドメイン、学校Workspaceの第三者アプリ許可を確認する。共有プレビューは本番APIを使うため、画面だけのPRプレビューでは新しいAPIを検証できない。許可された非本番フルスタック環境で両方の同一バージョンを使い、テスト用クラス・架空名簿で確認する。

実Google OAuth/学校管理設定/本物のClassroom/クラウド・iPad Safari実機は別検証。今回のローカル実装ではクラウド設定、デプロイ、PR、push、マージは行わない。将来PRにする際はREADME・DocsのPR手順に従い、結果・未検証項目を記載して本番反映の承諾を待つ。

公式資料：
- https://developers.google.com/workspace/classroom/guides/auth
- https://developers.google.com/workspace/classroom/reference/rest/v1/courses/list
- https://developers.google.com/workspace/classroom/reference/rest/v1/courses.students/list
- https://firebase.google.com/docs/auth/web/google-signin

## 今回の検証結果（2026-11-08）

- `CI=1 CLASSROOM_MOCK=1 NEXT_PUBLIC_CLASSROOM_MOCK=1 T167_TEST_PORT_OFFSET=31000 bash scripts/dev.sh check`：終了コード0。lint・型・ビルド・Web単体37件・API単体89件を含む単体/結合219件成功（実モデル等2件skip）・Rules14件・画面59件成功。APIの行99.36%、分岐86.87%、関数97.12%、文95.19%。
- 同じ最終ビルドと専用エミュレータで`playwright.classroom.config.ts`：12件成功。継承したmobileと追加のChromiumスマホ/PC、WebKitタブレットの4プロジェクトで各3件。実機Safariとは区別する。
- 作成→名簿の未参加→生徒の所属確認と参加→参加済み→履歴のクラス名、権限拒否/再接続、空クラス/通信切断の区別を検証した。APIでは別アカウント・所属外・失効Cookie・新規参加の制限・名簿の認可も検査した。
- 既存参加APIの余分なroleを無視する互換性、教員が`/home`を直接開いた場合のメニューの戻り先、生成済みテスト報告書のlint除外を修正した。テストの旧メニュー参照と模擬OAuth完了待ちも追従した。
- 作業開始時の共通画面・議論フローを隔離コピーして検証した。並行している「事前意見を省く」等の別変更は含めない。統合時にはClassroom部分だけを適用し、統合担当側でも再検査する。既存Workspaceルーターに同名のClassroom APIがある場合は二重登録せず、新しいルーターへ一本化する。
- 最終結果は最後まで完走した検査だけを採用した。途中で失敗・中断した実行を成功には数えていない。
- 実Google・Cloud設定・実iPadの検証は未実施。クラウド変更、PR、push、マージ、本番反映は行っていない。

## 操作用プレビュー

検証済みの最終ビルドを専用ポートで起動した。PCは http://127.0.0.1:34000/ 、同じWi-FiのiPadは http://Ryota-Murakami-Mac-mini.local:34000/ 。Macで両ホストのHTTP 200を確認済みだが、実iPadでの操作確認ではない。既存の17000番は変更していない。PCは既存localhost環境とCookieが混ざらない127.0.0.1を使い、iPadも既存の数値IPと別のホスト名で開く。

「Googleで続行」で模擬アカウントの `local-teacher@example.com` または `local-student@example.com` を選ぶ。ホームのClassroom連携からサンプルクラスを選択する。教員はクラス付きの議論を作成でき、生徒はホームから参加できる。実Gmail・本物の学校名簿を入力しない。このHTTPのiPad向けURLは画面確認用で、マイク録音にはHTTPSが必要。Macと専用サーバーの起動中だけ利用できる。
