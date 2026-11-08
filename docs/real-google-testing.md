# 実Google連携と公開音声の検証

共通の模擬環境と、実Google認証用の環境は別ポート・別データで動かす。PR、push、mainへのマージ、本番配備は実行しない。Geminiのモデル・global接続・LOW設定は`infra/env.sh`と既存実装を維持する。

## 内部で実Googleを検証する

対象プロジェクトへアクセスできる本人が既存のADCで認証する。鍵やトークンをチャットやリポジトリへ渡さない。Firebaseの公開Web設定は既存プロジェクトから自動取得する。Node22/Java21と依存を準備し、次を実行する。

```bash
bash scripts/dev.sh serve-google
```

利用者向け共通入口は`https://192.168.10.117:35443/`に統一する（同じWi-Fi・端末の証明書信頼設定が必要）。以下の`http://localhost:17100`は、現在のFirebaseでlocalhostのみが既に承認されているための担当者用内部検証口で、通常の参加コード発行・入力の入口とは分ける。共通入口の最新版切替は主担当が既存コード・録音・認証への影響を確認して管理する。

内部OAuth試験で`http://localhost:17100`を開く。別ポートは`T167_GOOGLE_PORT`で指定できる。Web/API/Firestore/hub/logging/websocketに指定ポートから連続6ポートを使う。すべてloopbackのみ。共通の17000番を再起動しない。

- Googleログイン、追加OAuth、Drive・Classroom、Geminiは実サービスへ接続する。Firestoreへの書き込みは専用のローカルエミュレータへ固定し、本番の授業データと分離する。
- Google本人のログイン・追加同意は本人が行う。通常の議論作成はGoogleログインと有効なアプリセッションを持つ全員に許可し、teacher claimを使用しない。Classroomに紐づける作成は当該コースの教師を検証する。作成後のHost権限は対象の議論のmembers.roleで判定する。
- Drive・Picker・Classroom APIの有効化、Google APIの利用規約、OAuth同意画面の対象ユーザー・スコープ、学校の第三者アプリ制限はGoogle側で確認する。Picker用の公開キーは既存の適切な制限付きキーまたは専用キーを使用する。既存キーの制限を広げない。
- Hostで試験用セッションを作成し、Driveから個人情報のないPDF/Docsを明示共有する。別ブラウザのGuestで閲覧し、共有解除後の取得拒否を確認する。元ファイルのACLは変更しない。
- Classroomはクラス選択→Host作成→名簿→Guest参加を確認する。クラス未所属/同意拒否でも通常のセッションを使えることを確認する。
- 個人端末の音声登録と話者識別には、`speaker-setup`で準備した`SPEAKER_PYTHON`、`SPEAKER_EMBEDDING_MODEL`、`SPEAKER_VAD_MODEL`を指定する。未指定を実モデルの確認済みと扱わない。
- ブラウザ用と通常のビルドは`.next-real`と`.next`で分離する。停止は起動したターミナルのCtrl+C。自分が起動した子プロセスだけを停止する。

Firebase popup方式のSDKは承認済みIPv4にも対応するが、現在の共通IPは未登録。共通入口を実Googleへ切り替える際は、認証ドメイン追加と既存の模擬UID・参加コードの扱いを主担当が確認し、無断で混在させない。Googleの直接OAuth JavaScript起点の制約と同一視しない（[公式SDKの検証処理](https://github.com/firebase/firebase-js-sdk/blob/master/packages/auth/src/core/util/validate_origin.ts)）。

この内部環境はこのMacのlocalhostでの確認用。スマホから実Google・録音を使う検証には承認済みのHTTPSオリジンが別途必要で、HTTPのLANプレビューとは区別する。

## 公開音声で実Geminiの通し試験をする

使用許可のある公開音声の16kHz mono PCM16 WAVを指定する。通常の自動試験には含めず、明示実行時だけ実APIの費用が発生する。CAM++/Sileroモデルは`speaker-setup`の準備先を指定する。

```bash
T167_PUBLIC_AUDIO_FILE=/absolute/path/public-sample.wav \
SPEAKER_PYTHON=/absolute/path/speaker-venv/bin/python \
SPEAKER_EMBEDDING_MODEL=/absolute/path/campplus.onnx \
SPEAKER_VAD_MODEL=/absolute/path/silero-vad.onnx \
T167_TEST_PORT_OFFSET=38000 bash scripts/dev.sh real-check
```

専用Auth/Firestoreエミュレータと本番形式ビルドを使う。Chromiumのマイク入力へ公開WAVを流し、共有端末の匿名参加→録音→実文字起こし→Hostの根拠付き分析→Host終了→録音分析→公開結果表示を検査する。Googleログイン自体は模擬であり、実Google同意や学校のクラス・実教室の識別精度を検証したことにはならない。結果の画像・トレースはPlaywrightの生成物に保存する。

## 検証範囲

通常の`bash scripts/dev.sh check`はGoogle HTTP・Geminiを代替する。実APIの直接呼び出し成功、ブラウザから実APIへの通し試験、実Googleの追加同意/Driveファイル/学校名簿、物理端末での録音は分けて記録する。`/health`の`gemini:gemini`だけでは生成成功とはしない。
