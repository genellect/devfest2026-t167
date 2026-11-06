# MVPデモの操作と反映条件

Google Docs「MVPフロー」と「仮アーキテクト図」を2026-11-06に確認した。UIはmainにマージ済みのFigma v0.5の色・書体・Header・カード・ボタンを使う。固定の教師/生徒ロールは選ばず、同じ利用者が議論ごとにHostまたはGuestになる。

## 操作する

```bash
bash scripts/dev.sh setup
# 別の作業とポートを共有しない。ブラウザでは http://localhost:28000 を開く。
T167_TEST_PORT_OFFSET=25000 bash scripts/dev.sh serve
```

ローカルはFirebase Authentication/FirestoreのエミュレータとGemini・音声登録のモックを使用する。ログイン画面にエミュレータ専用ボタンが出る。本番ビルドでは出ない。HostとGuestは別のブラウザープロファイルかプライベートウィンドウで開く。架空の名前・議論だけを使う。

1. HostはGoogleログイン → 共通ホーム →「参加する」→「ホスト」。セッション名・テーマ・制限時間（1〜30分）・グループ数・録音の有無を設定して作成する。
2. GuestもGoogleログイン → 共通ホーム →「参加する」→「ゲスト」。6文字のコードを入力するか、参加用QRの写真を読み取る。QRは同じアプリのURLだけを受け付ける。
3. Guestは表示名と所属グループを入力する。個人端末は初回に9秒の声を登録し、次回から同じモデル版の特徴を再利用する。共有端末では全員の表示名を追加し、1人ずつ音声登録する。共有端末の特徴は議論終了時に削除する。
4. Guestは待機画面へ進む。Hostの画面には各グループの参加者と登録状況が出る。全員の準備が済むまで開始できない。
5. Hostが開始する。Guestに届くのは自グループと、Hostが表示を許可したテーマ・残り時間・名簿だけ。表示停止は次の更新で反映する（通常2秒以内）。
6. 録音するグループは全員の同意を確認し、Guest1台で「録音を始める」を押す。ほかの端末の録音担当取得は拒否する。30分または約11MBで録音を止める。
7. 制限時間になるか、Hostが終了を確認すると全員が結果へ進む。期限はサーバーが判定し、端末がオフラインでも復帰時に延長しない。Hostは結果の自動公開を事前に選べる。
8. 担当端末の録音は停止して端末に残し、終了後5分以内に同一オリジンのAPIへ送る。Geminiが議論の流れ・よかった点・次の行動を分析する。Hostは全グループ、Guestは公開済みの自グループだけを閲覧し、ホームへ戻る。

録音を途中で手動停止した場合も、議論終了時に送信する。通信・AIの失敗では録音を端末に保持し、再送・ダウンロードできる。再読込後も同じアカウント・議論の保存済み音声を回収する。ブラウザの保存領域を削除した場合や録音中の強制終了は回収を保証しない。

個人の音声特徴はホームの「保存した声の特徴を削除」から本人が削除する。特徴は声の登録と再利用のための情報で、Google本人認証の代替ではない。現段階では登録特徴を使った継続的な話者照合や個人別の発言率、逐語のリアルタイム字幕は表示しない。

## APIとデータ

新MVPは`mvpDiscussions`・`mvpUsers`・`mvpCodes`を使い、既存の`rooms`を移動・削除しない。新コレクションは既存Rulesのデフォルト拒否によりブラウザから読み書きできない。IDトークン・所属・議論内のroleを検査するAPIだけがアクセスする。音声・特徴・認証情報はログに出さない。

| API（先頭に`/api/discussions`） | 利用条件 |
|---|---|
| `POST /create`、`GET /list`、`POST /join` | Googleログイン。roleはサーバーで付与 |
| `GET /room/{id}` | 所属を確認。Guest向け応答を許可項目・自グループに制限 |
| `POST /room/{id}/names`、`voice/{attendee}` | 開始前の本人。音声は明示同意と8〜12秒のPCMが必要 |
| `POST /room/{id}/settings`、`start`、`finish` | Hostのみ。開始後は表示・公開設定だけ変更可能 |
| `POST /room/{id}/claim-recording` | 登録済みGuest。グループごとに録音担当を1端末に固定 |
| `POST /room/{id}/recording` | 担当端末・同意・終了後5分以内・12MB/30分まで。グループごとに分析は3回まで、失敗後は30秒あける |
| `POST /voice/delete` | 本人の個人音声特徴を削除 |

## 仮図と現在の構成の差

Next.js/App Hosting → `/api` → Cloud Run → Vertex AI/Firestoreというmainの構成を維持する。仮図のCloud Storageへの録音保存と専用Speech-to-Textは追加しない。議論の録音はGeminiへ直接送り、処理後はサーバーに残さない。登録用音声もメモリ上で特徴を抽出し、元音声は保存しない。Classroom、課題配布、Forms、Calendar、Drive/Docsへのレポート保存は仮図でも拡張範囲であり、MVPには含めない。

実音声登録は[公式のSherpa-ONNX API](https://github.com/k2-fsa/sherpa-onnx/blob/master/python-api-examples/speaker-identification.py)とWeSpeakerモデルを使う。APIイメージのビルド時にPython依存とモデルを取得する。ローカルで実モデルを使う場合は`api/voice/requirements.txt`を専用venvへ入れ、`MVP_VOICE_PYTHON`と`MVP_VOICE_MODEL`を指定する。実Geminiは既存の`GEMINI_MOCK=0`を使う。モックへの自動切り替えはしない。

## 本番反映の前に確認する

- このPRはmainから直接作成し、既存の未マージPRに依存しない。mainへのマージ・auto-merge・本番デプロイはYuto Matsuiの事前承諾後に行う。infra変更を含むため、もう1人のレビューも必要。
- 管理者が`infra/setup-project.sh`の`roles/firebaseauth.viewer`をAPI実行用SAへ適用する。これはIDトークンの失効確認に必要な読み取り権限で、利用者やclaimを変更する権限ではない。この作業でIAMは変更しない。
- 自動previewは画面だけを更新し、本番APIを共有する。新しいAPIの反映前はGoogleログイン以降のMVP操作を通せない。previewビルドの成功と、同一コミットのAPI/Webでの検証を区別する。
- 承諾後は同一コミットのAPI・Webを反映し、実Googleログイン、実Gemini、iPad/iPhoneのマイク・長時間録音・画面ロックを確認する。エミュレータやChromiumの検証結果を実機・実クラウドの成功と報告しない。
