# Topos MVP：セッション内ロールと認証

学校でのTeacher/Studentと議論のHost/Participantを分離し、全員がGoogleでログインする。ディスカッションを作れるのは、管理者が招待した教員（Google アカウントの teacher claim）だけ（Docs「サーバーフィードバック」）。作成後の Host/Participant は、セッションごとの members.role で決める。画面での役割選択とClassroom接続は利用条件にしない。ログインの上限は全員1台。

## ユーザー体験

- ログイン後、教員は教員のホーム（`/teacher`）、学生は参加コードの入力（`/join`）へ進む。学生のホームは `/home`。旧 `/host` は `/teacher`、旧 `/signup`・`/student` は `/home`、旧 `/participate` は `/join` へ転送する。
- 教員はテーマ（必須）とクラス名（任意）だけで議論を作り、その議論の Host になる。録音などの設定は作成後の画面で変える。ダッシュボードで複数グループの進行・参加者・結果を確認する。
- Hostのセッション開始前は、事前意見がそろってもグループの議論を開始しない。Hostはグループの追加、名前/録音担当の変更、所属の割り当て、開始・終了、結果公開を操作する。番号の欠損による誤所属を防ぐため、削除は開始前の最後の空グループのみ。最低1グループを残す。
- Participantはコード/QRで参加し、Host指定の所属方法に従う。自分のグループだけの情報を受け取り、Host公開後だけ結果を閲覧する。全体結果と他グループの結果は送らない。
- UIは共通のMaterial Design 3の色・形状・フォーカス・操作領域を使う。公開停止時は結果配信を消去する。受領済みの情報を端末から完全に回収できるという保証ではない。

## 認証と議論の名前空間

| 用途 | 保存先 | API |
|---|---|---|
| 利用者 | users/{uid} | Googleログイン時の本人情報 |
| ログイン端末 | users/{uid}/sessions/{authenticationSessionId} | /sessions（既存） |
| 議論セッション | sessions/{discussionId} | /rooms（既存互換パス）、/discussions（本人の一覧） |
| 所属 | sessions/{discussionId}/members/{uid} | /rooms/{id}/me、参加/Host管理 |
| グループ | sessions/{discussionId}/groups/{groupId} | /rooms/{id}/groups |
| 分析結果 | sessions/{discussionId}/results/{resultId} | /rooms/{id}/results/{resultId} |

membersはuid、role（host/participant）、groupId（文字列またはnull）、joinedAt、statusを持つ。既存の集計・録音処理のため数値groupも同時にサーバーで更新する。HostのgroupIdはnull。同じ利用者でもセッションごとに異なるroleを持つ。

Host付与はセッション・参加コード・初期グループ・利用者・membershipと同じFirestoreトランザクションで行う。参加APIはParticipantだけを付与し、Host自身が再参加しても既存の権限を降格しない。クライアント指定roleは権限に利用しない。

## 認可

Express/TypeScriptを継続する（FastAPI移行は行わない）。APIはGoogle本人認証＋サーバー検証済みHttpOnly Cookie＋対象セッションmembershipを検査する。Host専用操作はmembers.role=hostのみ。Hostでも学校管理者APIは使用できない。学校管理者claimは将来の学校ポリシー管理専用として残す。

Firestore/Storageへのクライアント直接読み書きは引き続き全面拒否する。独自ログインセッションを検査できないRulesにクライアント操作を許可しない。Admin SDKはRulesを通らないため、すべてのAPIとライブ配信で認可する。参加者のライブ配信も自身/所属グループに限定し、結果公開・membership・ログイン失効を再検査する。非公開意見本文は本人以外に返さない。

## ログインポリシー

全ユーザー同時ログインの初期上限は1。新端末では旧端末を失効。役割から有効期限や上限を決めない。設定はapi/src/session-policy.tsに集約し、maxConcurrentSessions（1〜10）を学校管理者が将来変更できる。旧studentLimit/teacherLimit/adminLimitは読み取り時に無視し共通上限1に移行する。新設定APIで旧キーは受け付けない。

7日未利用で失効、共用端末15分無操作でロック、ログアウト/全端末ログアウト、サーバー検証、録音の端末保存を維持。取得・自動更新・バックグラウンド配信では利用期限を延長しない。

## Classroom拡張（MVPとは独立）

MVPのログインではClassroom権限を要求しない。拡張時は任意の「Classroomを連携」で追加同意を求める。コース一覧の読み取りにclassroom.courses.readonlyを用い、teacherId=me/studentId=meでコース単位の役割を確認する。名簿が必要な機能の追加時だけclassroom.rosters.readonlyを検討する。書き込み権限を一括要求しない。

連携情報はusers/{uid}/classroomCourses/{courseId}などに分離し、teacher/studentをmembers.roleへ転記しない。所属なし・拒否・学校側の利用制限・連携障害でも共通ホームを使用できる。複数コース/両役割ならコース選択を設ける。OAuth審査、学校管理者のアプリ設定、未成年者のアクセス制限、失効時のトークン破棄は実連携のリリース前に確認する。MVPではOAuthトークンの収集・保存を実装しない。

公式資料：
- https://developers.google.com/workspace/classroom/reference/rest/v1/courses/list
- https://developers.google.com/workspace/classroom/guides/auth
- https://developers.google.com/workspace/classroom/guides/key-concepts/user-types
- https://developers.google.com/workspace/classroom/guides/key-concepts/admin-actions

## 切り替えと検証

先行PR #32の認証セッション実装を前提とする。旧 rooms コレクション/role=moderatorからの自動読み替えは行わない。旧データは本番で削除・移動せず保持する。本番切り替え時は承認されたメンテナンス時間でデータ移行の要否を確認し、索引/Rules/API/Webを同一版へ反映する。既存セッションと議論の移行は管理者レビュー対象。TTLのsessionsコレクショングループはdeleteAtを持つ認証用文書だけを削除するため、議論セッションにdeleteAtを付けない。

検証はエミュレータとモックを使い、本物の児童生徒の情報や実クラウドへ書き込まない。役割の兼任、権限逸脱、他セッション/他グループの遮断、公開/公開停止、録音担当、ログイン失効、Classroom未連携での一連の操作を検査する。

## 確定したMVPフロー（追記）

教員：教員のホーム → 新規作成（この議論の Host になる） → 管理画面で設定 → 開始 → 複数グループの情報を確認 → 設定時間経過または強制終了 → 結果 → ホーム。
学生：参加コードの入力（コード/QR） → 表示名 → 音声登録 → 所属確認/待機 → Host開始 → 許可された情報を閲覧 → 時間経過/Host終了 → 公開結果 → ホーム。学生は、データ上は role=participant。

### 音声登録

セッション画面は、2026-11-09 に依頼者から受け取った最新UIのスクリーンショットと追加の修正指示を参考に、淡いブルーと白いカードで構成する。待機・議論中・結果の画面からサイドバーと上部バーを外す。戻るアイコンは待機・結果だけに置き、議論中は表示しない。Hostの待機画面ではテーマを大きく表示し、参加コードはQRと同じカードにまとめる。グループカードは最大300px幅で、1グループでも横に広げない。参加者名・声の登録・事前意見・録音担当を示す。議論中は取得済みの検討率と発言状況をグラフで表示し、グループカードを押すと下から参加者名・発言時間・推移の詳細が開く。未取得のデータは集計待ちとする。大きな終了ボタンから確認ダイアログを開き、キャンセルでは議論を続ける。資料の追加ボタンにはGoogle公式配布のDriveアイコンを使用する。学生の議論中は録音と発言メモをPC幅で2列、スマホ幅で1列にする。ホーム・ログイン画面の実装とは分けている。

声の登録は円形のマイクを押し、9秒の進捗を確かめながら読み上げる。事前意見の提出後は開始待ちへ切り替え、提出内容は折りたたみから確認・編集できる。議論中は録音担当と録音中の経過時間を区別して表示する。時間制限を設定していないセッションでは、ゲストの残り時間表示と時間切れ確認を行わない。

終了後はホストの結果画面で公開状態を直接切り替えられる。公開後のゲスト画面は、本人の事前意見と結論の一文を並べ、議論の前後を比較できる。公開停止時は結果画面を消す。本文は既存の本人限定API配信だけを使用し、ホストの参加者一覧には本文を出さない。`web/e2e/session-screens.spec.ts` で7画面、待機中の編集、公開と公開停止、PC・スマホ幅の横はみ出しを検査する。

各自の端末はGoogle UIDに紐づくusers/{uid}/voiceProfiles/defaultに声の特徴ベクトルとモデル版を保存し、同じ版なら再登録不要。元の音声は推論後に消去し、ログ・Firestoreへ保存しない。本人は/voice-profile/deleteで再利用する登録情報を削除できる。

1台を共有する場合、ログインアカウントが端末内の名簿（表示名・ランダム参加者ID）を管理する。各人のGoogle本人確認を済ませたという意味ではない。全員の声をセッションごとに登録し、sessions/{id}/voiceProfilesへ保存、終了時に削除する。別アカウントのリンクや保存済みプロフィールの共用端末での再利用は拡張案件とする。

音声特徴の抽出は別作業で準備されているSherpa-ONNXワーカーをアダプター経由で使用する。SPEAKER_PYTHON・SPEAKER_EMBEDDING_MODEL・SPEAKER_VAD_MODELが必要。モデル版変更時はVOICE_MODEL_VERSIONも変更し再登録を要求する。ローカルの明示的なエミュレータ/モック起動では音声モックと表示する。登録は話者の本人認証や識別精度の保証ではない。登録した特徴を発言時間の集計へ使う接続は下記のとおり実装する。リアルタイム字幕は別の音声実装との統合作業になる。

### 終了処理

Host開始時にサーバー時刻からendsAtを設定。すべての保護操作・ライブ配信・期限確認APIで期限を検査する。終了すると議論への新規参加と発言を拒否し、結果画面へ移る。録音は停止・保存して分析用送信へ進め、終了後5分間は認証/所属を検査して送信を受け付ける。全クライアントがオフラインでも期限を延長せず、復帰時にサーバーが終了を確定する。常駐ジョブや新規クラウドサービスは追加しない。

## 登録音声とリアルタイム話者識別の接続

録音担当端末のMediaRecorderと同じMediaStreamをAudioWorkletへ接続し、16kHz mono PCM16を1秒ずつAPIへ送る。新たなマイク取得や第三者の話者識別API呼び出しは行わない。所属グループの各参加者の登録情報をサーバーで読み、CAM++の特徴ベクトルをコサイン類似度で照合する。個人端末はGoogle UIDのプロフィール、共有端末はその回の各参加者のプロフィールを使う。特徴ベクトルはクライアントへ返さない。

類似度0.5以上かつ次点との差0.08以上の場合だけ話者を割り当て、それ以外は判別不能とする。400ms未満の発話は話者を割り当てない。Silero VADで検出した発話時間だけを集計する。無音は除外し、判別不能時間は発言率の分母に残す。1秒区間内の交代・同時発話を分離する保証はない。送信開始前と最後の1秒未満、処理が停止した後の区間はこの集計に含まない。完全な録音は既存の端末保管・終了後分析で扱う。

Host画面は全グループの発言者・時間・割合・判別不能を表示する。あわせて「発言率の推移」を折れ線で示す（横軸は録音開始からの分、縦軸はその時点までの発話時間に占める累積の割合。判別不能も1本の線として残す）。議論の終了後も、Hostの結果画面に同じ集計と推移を表示する。Guest表示はparticipantView.speaking=trueをHostが指定した場合だけ自グループを配信し、終了後はresultsPublished=trueも必要。終了後の配信では、サーバーが本人（共有端末ではその端末の参加者）の時間と、割合の分母になるグループ全体の時間・声を登録した人数だけに絞り、ほかの参加者の名前・時間・直近の発言者は送らない。Guestの結果画面では、これを「議論の流れとあなたの発言率」として、本人の発言率（直前2分）の折れ線の下に議論の流れを同じ時間軸で並べる。初期設定は非表示。公開停止では配信データと表示を消去する。

### APIと保存先

| API | 認可・条件 |
|---|---|
| GET /rooms/{id}/speaker/config | 有効なログインとセッション所属 |
| POST /rooms/{id}/speaker/start | Participant・所属グループ・Host開始後・録音許可・全員登録済み・明示同意。Host指定の録音担当があれば本人のみ |
| POST /rooms/{id}/speaker/{runId}/chunk?sequence=N | 同じログインセッション・担当・所属・名簿・モデル版を再検査。1秒のPCMのみ |
| POST /rooms/{id}/speaker/{runId}/stop | 同じ録音担当の接続を解放 |

sessions/{id}/speakerLeases/{group}に30秒の担当リースと送信順序を、speaking/{group}に表示名・参加者ID・時間の集計と、録音の1分ごとの発話時間（timeline：話者ごとの時間と判別不能の時間）を保存する。音声や特徴はここへ保存しない。同じ区間の再送を二重計上せず、高速送信・他端末・他グループを拒否する。推論中に終了・失効・プロフィール削除があれば確定前に再検査して破棄する。背景音声送信はログインの最終利用時刻を延長しない。

通信断・認証失効・処理遅延では話者識別の送信を停止する。元のMediaRecorderと既存の端末保管は維持する。認証失効時は既存の録音保護処理で録音を停止・保管する。話者集計の未処理区間を自動で埋めたと扱わない。再接続には録音の再開始が必要で、更新された名簿・モデルの結果は旧集計と混ぜない。

### ローカル実モデルの準備と検証

```bash
bash scripts/dev.sh speaker-setup
# macOSの組み込み合成音声から2種類の日本語WAVを生成（マイク不要）
python3 speech/synthetic_samples.py
SPEAKER_TEST_VOICES="$PWD/.local-data/speaker-samples/kyoko.wav,$PWD/.local-data/speaker-samples/eddy.wav" \
  T167_TEST_PORT_OFFSET=33000 bash scripts/dev.sh speaker-check
```

setupは固定版Python依存を専用venvへ入れ、公式配布モデルのSHA-256を検証する。モデル・合成音声・venvは.local-data以下でGit管理しない。Linuxでは別途16kHz mono PCM16 WAVの合成音声2本（各9秒以上）を指定する。検証は先頭8秒を共有端末の2人としてAPI登録し、未登録の8〜9秒区間をchunk APIへ送る。無音除外、終了時の一時プロフィール削除も検査する。通常のcheckは実モデル試験を明示的にskipし、このコマンドで別に確認する。

実モデルで画面を開く場合も、認証・Firestore・Geminiはローカルのままで使える。

```bash
SPEAKER_PYTHON="$PWD/.local-data/speaker-venv/bin/python" \
SPEAKER_EMBEDDING_MODEL="$PWD/.local-data/speaker-models/campplus.onnx" \
SPEAKER_VAD_MODEL="$PWD/.local-data/speaker-models/silero-vad.onnx" \
T167_TEST_PORT_OFFSET=30000 bash scripts/dev.sh serve
```

実モデルが指定されている場合はGeminiモック起動中でも実話者モデルを優先する。接続失敗時に音声モックへフォールバックしない。モデル未指定のローカル起動だけ音声モックを明示表示する。api/DockerfileにもPython・固定版の推論依存・チェックサム検証済みモデルを同梱し、ワークフローのビルドcontextをルートへ変更した。実コンテナのビルド/起動・Cloud Runでの同時処理・実機検証は別途必要。構成の回帰テストを、実コンテナ成功とは扱わない。クラウドの設定変更・デプロイは実行していない。

この接続は話者照合と発話時間の集計を対象とする。Google Speech-to-Textによるリアルタイム字幕の有効化・実接続は行わない。日本語の実話者・教室の騒音・同時発話・iPad実機での精度は未検証。

モデル/API根拠：[Sherpa ONNX公式の話者識別](https://k2-fsa.github.io/sherpa/onnx/speaker-identification/index.html)。声はログインやHost権限の判定には使用しない。

2026-11-06の実モデル検証では、再現用スクリプトで生成したKyoko/Eddyの日本語合成音声を、共有端末の2人としてAPIへ各8秒登録した。未登録の8〜9秒区間の類似度はそれぞれ0.778 / 0.684、発話時間は958ms / 638msで本人へ照合できた。1秒の無音は発話として計上せず、終了後の共有プロフィール削除も確認した。これは2種類の合成音声による接続確認で、実際の教室での正答率を示す値ではない。

## 最新フロントエンドへの接続と公開人声試験

GitHubのmain（017b78f）と公開済みPRを確認し、認証セッションPR #32（0f5cb9e）の上へ今回のMVPフローと音声UIを積み上げる。他の作業ブランチや共有プレビューの本番APIは変更しない。音声登録には9秒の進捗表示、8〜12秒・1MB以内の録音済み音声からの登録、録音の明示停止、送信・分析の状態表示を用意する。ホームの終了表示は議論のendedAtを反映する。

公開人声試験にはSherpa公式Nodeサンプルが参照する[csukuangfj/sr-data](https://github.com/csukuangfj/sr-data)の登録用・識別用の別録音を使用する（Apache-2.0）。`python3 speech/public_samples.py`で取得し、使用したリビジョン・出典・SHA-256を.local-data/public-voices/sources.jsonへ記録する。音声ファイルはPRへ含めない。これは中国語の公開人声2種類の接続確認で、日本語教室の精度試験ではない。

`web/playwright.speaker.config.ts`は専用の実モデル画面試験用。SPEAKER_PYTHON、SPEAKER_EMBEDDING_MODEL、SPEAKER_VAD_MODEL、SPEAKER_LIVE_TEST_WAV（公開識別音声から作ったdiscussion.wav）を渡す。登録用ファイルは画面のファイル選択から送り、別録音をChromiumの擬似マイク入力へ流して、AudioWorklet→API→実モデル→Host/Guest表示・終了まで確認する。マイクのハードウェアや実iPadの検査とは区別する。Firestore/Auth/Geminiはエミュレータ/モックのまま、実際の話者モデルだけを実行する。

### 公開人声の実データ検証結果（2026-11-06）

出典リビジョンはsr-dataの92b4978ba6b4358e95be385e51e86ece86524d33。登録用ファイルを同一話者ごとに連結して先頭8秒を登録し、識別には別のtest録音を使用した。`scripts/public-speaker-evaluate.mjs`は実モデルで1秒区間を処理し、音声・特徴をログへ出さず集計のみ記録する。

| 公開人声 | 評価区間 | 400ms以上の発話区間 | 正しく照合 | 判別不能 | 別話者への誤割当 |
|---|---:|---:|---:|---:|---:|
| サンプルA | 5 | 3 | 3 | 0 | 0 |
| サンプルB | 8 | 7 | 5 | 2 | 0 |

残る3区間は無音または短い発話として話者評価から除外した。2人・短い録音の結果で、一般的な識別精度や日本語教室の正答率を示さない。

ブラウザ通し試験は、画面のファイル選択から2人の登録音声を送り、別録音を擬似マイクからAudioWorklet→API→実モデルへ流した。Host/Guestの実モデル表示、両者の発話時間、録音停止・端末保管、終了、ホームの終了表示まで検査する。共有端末の人数表示はアカウント数ではなく参加者名簿を数える。400msなどの短い発話時間は小数1桁の秒数で示す。

専用試験では、直前のcheckでビルドしたNEXT_PUBLIC_FIREBASE_PROJECT_ID・エミュレータのポートに実行環境を合わせ、API_ORIGINも明示する（今回のオフセット30000ではhttp://127.0.0.1:38081）。Firestore/Authは専用エミュレータ、Gemini分析はモック、話者モデルと入力人声は実データ。クラウドpreviewは旧本番APIと共有するため、この通し結果とは分ける。

## 教員の招待（作成の権限）

- `POST /rooms` は、IDトークンの `teacher: true`（管理者が付けた custom claim）を確かめる。ない場合は `403 teacher_required`。本文の `teacher`・`role` は使わない。
- 作成者はそのセッションの Host になる。Host 用の操作は members.role=host で判定し、teacher claim では判定しない。教員が他の教員のセッションに参加すれば、そこでは Participant になる。
- 画面の振り分け（ログイン後の行き先、作成ボタンの表示）は IDトークンの claim を読むだけで、権限はAPIが確かめる。
- 付与は管理者が `node scripts/teacher-access.mjs --project <プロジェクト> --email <メール> --action grant` で行う（`--uid` でもよい）。相手が一度 Google でログインしてから実行する。付与・解除のあとは以前のトークンを失効させるので、相手はログインし直す。メールアドレスと UID は出力しない。
- 対象は、チームの教員3人と審査員用のテストアカウント（Docs「サーバーフィードバック」）。メールアドレスはリポジトリに書かない。

### 本番で教師権限を付ける手順

この手順は、本番の Firebase Authentication を変える。オーナーかプロジェクトの編集者が行う。メールアドレスは、ターミナルの引数以外（PR・Issue・チャット・ログ）に書かない。

1. 対象の人に、本番の URL へ一度 Google でログインしてもらう。一度もログインしていないアカウントには付与できない。
2. 実行する場所を選ぶ。
   - 手元の PC（推奨。鍵を作らない）：編集者の Google アカウントで次を実行する。Node は 22.12 以上を使う。
     ```bash
     gcloud auth login
     gcloud auth application-default login
     gcloud auth application-default set-quota-project devfest2026-t167
     npm --prefix api ci
     ```
   - クラウドの Claude Code：[認証情報の手順](credentials.md)の「AI 用の鍵を作る」で鍵を作り、環境変数 `GCP_SA_KEY` に登録して、新しいセッションを開く。起動時のフックが gcloud にログインする。
3. 読み取りだけで状態を確かめる。`"googleLogin":true` で、`"disabled":false` なら付与できる。
   ```bash
   node scripts/teacher-access.mjs --project devfest2026-t167 --email <メールアドレス> --action inspect
   ```
4. 付与する。`{"teacher":true,"changed":true,"signInAgain":true}` が出れば成功。
   ```bash
   node scripts/teacher-access.mjs --project devfest2026-t167 --email <メールアドレス> --action grant
   ```
5. もう一度 `inspect` を実行し、`"teacher":true` になったことを確かめる。
6. 本人にログインし直してもらい、教員のホーム（`/teacher`）に進んで「ディスカッションを作る」が出ることを確かめる。
7. 外すときは `--action revoke` を同じように実行する。クラウド用の鍵は、提出のあと [認証情報の手順](credentials.md)の「抜けるとき・終わったとき」に従って消す。

この PR を本番に反映する前に、対象の全員に付与を済ませる。済む前に反映すると、本番ではだれもディスカッションを作れなくなる。

#### うまくいかないとき

スクリプトは、メールアドレス・UID・鍵を出さないため、失敗しても「教師権限を確認・更新できませんでした」としか表示しない。次の順に確かめる。

| 確かめること | 直し方 |
|---|---|
| 対象の人が本番に一度ログインしたか | 本番の URL で Google ログインしてもらう |
| ADC にログインしているか | `gcloud auth application-default login` をやり直す |
| 実行する人がプロジェクトの編集者以上か | オーナーのアカウントで実行する（Firebase Authentication の管理権限が要る） |
| エミュレータの環境変数が残っていないか | `unset FIREBASE_AUTH_EMULATOR_HOST FIRESTORE_EMULATOR_HOST` |
| Node が 22.12 以上か | `node --version` で確かめる |
| `api/` の依存関係が入っているか | `npm --prefix api ci` |

#### UID で付ける場合

メールアドレスを使いたくないときは、[Firebase コンソールの Authentication](https://console.firebase.google.com/project/devfest2026-t167/authentication/users) で対象の人の「ユーザー UID」をコピーし、手順3〜5の `--email <メールアドレス>` を `--uid <UID>` に置き換える。`--uid` は main のスクリプトでも使える。

#### 審査員用のテストアカウント

1. 審査員用の Google アカウントを作り、本番に一度ログインする。
2. 手順3〜5を同じように実行する。
3. 受け渡し方（提出用の README に書くかどうか）はオーナーが決める。パスワードはリポジトリに書かない。
