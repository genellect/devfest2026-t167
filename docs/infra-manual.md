# インフラ構築・運用手順書

Topos（チーム167）の Google Cloud・Firebase・GitHub を、作り直す・変える・運用するための手順。**この文書が正本**で、チームドキュメントの「インフラ構築手順書」タブは、ここへの案内だけにしている。

- 構築・権限・デプロイ・CI を変える PR では、この手順書も同じ PR で更新する（[AGENTS.md](../AGENTS.md)・[CONTRIBUTING](../CONTRIBUTING.md)）。
- メンバーのメールアドレス、クレジットコード、鍵の中身は書かない。メールアドレスは、実行するときに引数で渡す。
- 「いまの状態」と書いた値は、書いた日に本番の設定を読み取りで確かめたもの。

ほかの文書にあることは、ここに書かない。

| 内容 | 文書 |
|---|---|
| 開発の進め方、PR、本番反映の承諾 | [CONTRIBUTING](../CONTRIBUTING.md)、[AGENTS.md](../AGENTS.md)、[PR の確認から本番反映までの手順](contributor-preview-guide.md) |
| 認証情報（だれが持ち、どう渡し、どう止めるか。AI 用の鍵の記録） | [credentials](credentials.md) |
| API のエンドポイントと認可 | [API と認可](api.md) |
| 役割、教員の権限の付け方 | [MVPロール設計](mvp-roles.md) |
| 本番の URL での通しの確認 | [本番の URL で通しを確かめる手順](production-check.md) |
| 非本番の実 Gemini デモ | [クラウドデモ](cloud-demo.md) |
| 審査基準への対応、技術の選定理由 | [README](../README.md) |

## 全体構成

```text
ブラウザ（スマホ・PC）
  └─ App Hosting「web」（Next.js、asia-east1）
       └─ /api/* を Next.js の rewrites で転送
            └─ Cloud Run「api」（Express、asia-northeast1。音声モデルを同梱）
                 ├─ Vertex AI の Gemini（global）
                 ├─ Firestore（asia-northeast1）
                 └─ Firebase Authentication（ID トークンの失効確認）
```

- **ログイン**：全員 Google でログインする。API は Google 以外（匿名など）のトークンを `403` で断る。議論の作成は teacher claim を持つ教員だけ。
- **データの配信**：ブラウザは Firestore を直接読まない。Firestore と Storage の Rules はクライアントの読み書きをすべて拒否し、API が認可したうえで SSE で配信する。
- **同じオリジン**：ブラウザは常に同じオリジンの `/api` を呼ぶので、CORS の設定は要らない。
- **プレビュー**：App Hosting「web-preview」に、PR の `web/` だけを出す。API とデータは本番と共有する（[CONTRIBUTING の「画面のプレビュー」](../CONTRIBUTING.md#画面のプレビュー)）。

### Driveからの資料選択を使う場合

Google Picker APIとGoogle Drive APIを、FirebaseのWebアプリと同じGoogle Cloudプロジェクトで有効にする。Webアプリが使う公開APIキーでPicker APIを利用できること、HTTPリファラー制限にアプリのURLと`https://docs.google.com/*`が含まれることを確認する。PickerのアプリIDには同じプロジェクトの番号を使う。既定ではFirebaseの公開APIキーとappIdから読み取った番号を使い、分ける場合だけ`NEXT_PUBLIC_GOOGLE_PICKER_API_KEY`・`NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER`をビルド時に指定する。これらは公開設定で、長期のOAuth秘密鍵は追加しない。

追加のOAuth同意は、利用者が「Driveから追加」を押したときに`drive.file`だけを要求する。学校側で制限されている場合は許可を確認する。元のDriveの共有設定は変更せず、Hostが確認して追加したPDFの写しをセッションのメンバーへ配信する。ローカルの模擬ログイン環境では実GoogleのPickerは利用できない。今回、実クラウドでのAPI有効化・APIキー制限の変更・OAuthの実接続は行っていない。

参照：[Google PickerのWeb実装](https://developers.google.com/workspace/drive/picker/guides/web-picker)、[Driveのダウンロードとエクスポート](https://developers.google.com/workspace/drive/api/guides/manage-downloads)。

### 資源の一覧

| 資源 | 名前・場所 | 作るもの |
|---|---|---|
| プロジェクト | `devfest2026-t167` | 手順2 |
| Firestore | `(default)`、asia-northeast1 | `infra/setup-project.sh` |
| Artifact Registry | `app`、asia-northeast1 | `infra/setup-project.sh` |
| Cloud Run | `api`、asia-northeast1。2 CPU・2GiB・同時 8 リクエスト・最小 `API_MIN_INSTANCES`（既定 0）〜最大 2 台 | `.github/workflows/deploy.yml` |
| App Hosting | `web`（本番）と `web-preview`（プレビュー）、asia-east1。最大 4 台（`web/apphosting.yaml`） | 手順6、`infra/setup-preview.sh` |
| サービスアカウント | `api-runtime`（API の実行）、`github-deployer`（デプロイ）、`ai-dev`（クラウドの AI ツール） | 手順3・7・9 |
| WIF | プール `github`、プロバイダ `github-oidc`。`genellect/devfest2026-t167` だけを許可 | `infra/setup-deployer.sh` |
| 非本番デモ | `web-preview` のタグ付きリビジョンと、デモ用の Cloud Run サービス（2026-11-09 時点で `pr34-demo`） | `demo/`（[クラウドデモ](cloud-demo.md)） |

### 変数

手元の値は `infra/env.sh` に1か所でまとめている。ワークフローには ID を直書きしない。

| 変数 | いまの値 | 意味 |
|---|---|---|
| `PROJECT_ID` | `devfest2026-t167` | プロジェクト |
| `REGION` | `asia-northeast1` | Cloud Run・Firestore・Artifact Registry |
| `APPHOSTING_REGION` | `asia-east1` | App Hosting（東京は非対応） |
| `VERTEX_LOCATION` | `global` | Gemini の接続先（東京には通常の従量課金がない。依頼者が 2026-11-05 に承認） |
| `GEMINI_MODEL` | `gemini-3.5-flash` | モデル。変えるときは [CONTRIBUTING の「Gemini のモデルと費用」](../CONTRIBUTING.md#gemini-のモデルと費用) |
| `WEB_APP_NAME` | `t167-web` | 本番とプレビューが共有する Firebase の Web アプリ |
| `PREVIEW_BACKEND` | `web-preview` | プレビューのバックエンド |
| `DEV_REPO` | `genellect/devfest2026-t167` | 開発用リポジトリ（WIF はここだけを許可） |
| `SUBMIT_REPO` | `Devfest-Hackathon-2026/df-2026-t167` | 提出用リポジトリ |

Gemini の global 接続先では、処理する地域を日本国内に限定できない（[公式の接続先情報](https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/locations)）。

**GitHub の Actions の Variables**（Settings → Secrets and variables → Actions → Variables）。鍵ではない。

| 名前 | 必須 | 値 |
|---|---|---|
| `PROJECT_ID`・`REGION`・`VERTEX_LOCATION`・`GEMINI_MODEL` | 必須 | `infra/env.sh` と同じ |
| `WIF_PROVIDER`・`DEPLOYER_SA` | 必須 | `infra/setup-deployer.sh` の表示 |
| `API_MIN_INSTANCES` | 任意（未登録なら 0） | API の最小インスタンス数（0〜2）。下の「デモ・審査の前」 |

必須の6つが1つでも空なら、`deploy` は認証の前に止まる。一覧は `deploy.yml`・`infra/setup-deployer.sh`・[credentials](credentials.md) にあり、`tests/config.test.sh` が一致を確かめる。

## 構築の順番

作り直すときは、次の順に進める。いまの本番は、手順1〜12がすべて済んでいる（手順12の TTL を除く）。

1. クレジットの引き換えと請求先アカウント
2. プロジェクトの作成と予算アラート
3. 基盤の作成：`bash infra/setup-project.sh`
4. Firebase の追加と Authentication
5. リポジトリの用意と手元での起動
6. App Hosting のバックエンドと API の URL
7. デプロイ用サービスアカウントと WIF：`bash infra/setup-deployer.sh`
8. GitHub の設定：`bash infra/setup-github.sh`。Variables を登録し、`main` に push すると初回のデプロイが走る
9. メンバーと AI ツールの権限：`bash infra/setup-members.sh`
10. プレビュー：`preview` ワークフローが自動で用意する
11. 教員の権限：`node scripts/teacher-access.mjs`
12. セッションの保持期間（TTL）：`bash infra/setup-session-security.sh`

## 手順1：クレジットの引き換えと請求先アカウント

運営から代表者に届いたクレジットコードを、請求先アカウントに登録する。コードは1回しか使えず、チーム外への共有や公開の場への掲載は禁止。**コードそのものはどこにも書かない。**

1. [Google Cloud コンソール](https://console.cloud.google.com/) に、個人の Gmail アカウントでログインする。大学のアカウントは、組織の制限でプロジェクトや請求先を作れないことがある。
2. 「お支払い」から請求先アカウントを作り、支払い方法を登録する。クーポンを使うには有料アカウントへのアップグレードが要る。クレジットの範囲内なら費用はかからない。
3. https://cloud.google.com/redeem でプロモーションコードを入力する。
4. 「お支払い」→「クレジット」で反映を確かめ、金額と有効期限を控える（反映に最大15分ほどかかる）。

```bash
gcloud billing accounts list
export BILLING_ACCOUNT="XXXXXX-XXXXXX-XXXXXX"
export CREDIT_AMOUNT="3165JPY"   # 控えたクレジット額。通貨は請求先アカウントと同じにする
```

## 手順2：プロジェクトの作成と予算アラート

```bash
source infra/env.sh
gcloud projects create "$PROJECT_ID" --name="DevFest 2026 Team 167"
gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT"
gcloud config set project "$PROJECT_ID"
gcloud services enable billingbudgets.googleapis.com

# 予算1：クレジットの消費を監視する（クレジット控除前の金額で計算）
gcloud billing budgets create --billing-account="$BILLING_ACCOUNT" \
  --display-name="t167-credit-usage" --budget-amount="$CREDIT_AMOUNT" \
  --credit-types-treatment=exclude-all-credits --filter-projects="projects/$PROJECT_ID" \
  --threshold-rule=percent=0.5 --threshold-rule=percent=0.8 --threshold-rule=percent=1.0

# 予算2：実際の請求が発生したら知らせる（クレジット適用後の金額で計算）
gcloud billing budgets create --billing-account="$BILLING_ACCOUNT" \
  --display-name="t167-real-charge" --budget-amount=100JPY \
  --credit-types-treatment=include-all-credits --filter-projects="projects/$PROJECT_ID" \
  --threshold-rule=percent=0.1 --threshold-rule=percent=1.0
```

予算の既定は、クレジットを差し引いた後の金額で計算する。クレジットで相殺されている間は通知が来ないので、予算1はクレジット控除前で計算する。**予算アラートは通知するだけで、課金は止めない**（止める方法は「運用」の「費用の監視と上限」）。

**いまの状態（2026-11-09）**：予算1（月3,165円、50・80・100%）と予算2（月100円、10円・100円）の2本がある。どちらも支出上限（自動停止）は付けていない。請求先の権限がある人だけが確かめられる。

## 手順3：基盤の作成

```bash
bash infra/setup-project.sh
```

API の有効化、Firestore（asia-northeast1）、Artifact Registry（`app`）、API の実行用サービスアカウント `api-runtime` を作る。`api-runtime` には次の4つだけを付ける。ユーザーや claim を変える権限は付けない。

| ロール | 使いみち |
|---|---|
| `roles/datastore.user` | Firestore の読み書き |
| `roles/aiplatform.user` | Gemini の呼び出し |
| `roles/logging.logWriter` | ログ |
| `roles/firebaseauth.viewer` | ID トークンの失効確認（`verifyIdToken(token, true)` が利用者を読む） |

同じプロジェクトに2回実行しても壊れない。

## 手順4：Firebase の追加と Authentication

```bash
npm --prefix firebase run fb -- login --no-localhost
npm --prefix firebase run fb -- projects:addfirebase "$PROJECT_ID"
npm --prefix firebase run fb -- apps:create WEB "t167-web" --project "$PROJECT_ID"
```

[Firebase コンソール](https://console.firebase.google.com/) の「Authentication」→「Sign-in method」で、**Google** を有効にする。匿名ログインは使わない（API が断るので、有効のままでも画面からは使えない）。

**いまの状態（2026-11-09）**：Google と匿名の両方が有効。匿名は使っていないので、無効にしてよい（無効にするかは依頼者が決める）。

承認済みドメイン（「Settings」→「承認済みドメイン」）は、次のとおりに加える。

| ドメイン | 加えるもの |
|---|---|
| 本番の `web--<PROJECT_ID>.asia-east1.hosted.app` | 手順6のあとに、人がコンソールで加える |
| プレビューの `web-preview--…` | `infra/setup-preview.sh` が自動で加える |
| デモのタグ URL | `demo/authorize-domain.mjs`（[クラウドデモ](cloud-demo.md)） |

## 手順5：リポジトリの用意と手元での起動

1. GitHub で `genellect/devfest2026-t167` を Public で作る。公開リポジトリなので、鍵やトークンは置かない。作り直すときは、このリポジトリを複製する。
2. 手元で起動し、http://localhost:3000 で参加コード `100001` で参加できることを確かめる。手順は [CONTRIBUTING の「起動する」](../CONTRIBUTING.md#起動する)にある。手元では本物の GCP を使わない（Auth・Firestore・Storage はエミュレータ、Gemini と話者モデルはモック）。

## 手順6：App Hosting のバックエンドと API の URL

```bash
npm --prefix firebase run fb -- init apphosting --project "$PROJECT_ID"
```

対話では、バックエンド ID に `web`、リージョンに `asia-east1`、アプリのルートに `web` を指定し、手順4の Web アプリを紐づける。`firebase.json` の変更をコミットする。

続いて、`web/apphosting.yaml` の `API_ORIGIN` を Cloud Run の URL にする。URL はプロジェクト番号で決まるので、API をデプロイする前に書ける（`infra/setup-deployer.sh` の最後にも表示される）。

```bash
NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
echo "https://api-${NUMBER}.${REGION}.run.app"   # web/apphosting.yaml の API_ORIGIN に書く
```

## 手順7：デプロイ用サービスアカウントと WIF

```bash
bash infra/setup-deployer.sh
```

GitHub Actions 用の `github-deployer` と、鍵を使わない認証（WIF）を作り、Variables に登録する値を表示する。表示どおりに、必須の6つを登録する（上の「変数」）。

`github-deployer` には、速度を優先して編集者などを付けている（`roles/editor`・`roles/run.admin`・`roles/firebaserules.admin`・`roles/firebaseapphosting.admin`・`roles/iam.serviceAccountUser`）。プロジェクトの IAM 管理者は付けない。PR のコードが IAM を変えられないようにするため。

## 手順8：GitHub の設定

```bash
bash infra/setup-github.sh    # gh でログインしたリポジトリ管理者が1回実行する
```

- マージは squash だけにし、マージしたブランチを自動で削除し、auto-merge を使えるようにする。
- secret scanning と push protection を有効にする（公開リポジトリでは無料）。
- `main` のルール：PR 経由でだけ更新でき、CI の `test` の成功が必須で、force push と削除ができない。レビューの承認は必須にしない（速度優先。レビューが要る PR は `scripts/dev.sh pr` が auto-merge を付けないことで止める）。

管理者権限がなくて設定できなかった場合は、スクリプトがそう表示して続ける。

## 手順9：メンバーと AI ツールの権限

```bash
bash infra/setup-members.sh <GitHub のユーザー名> <メールアドレス>
```

- メールアドレスはプロジェクトの編集者にし、GitHub のユーザー名は開発用リポジトリの Collaborator（Write）に招待する。開発速度を優先し、メンバーは編集者にしている。
- クラウドの Claude Code・Codex から GCP を操作するときは、`ai-dev`（編集者）の鍵を人ごとに作る。作り方・登録のしかた・記録・止め方は [credentials](credentials.md) にある。
- クラウドの Claude Code では、`.claude/settings.json` の SessionStart のフックが `GCP_SA_KEY` で gcloud にログインする。このフックとスクリプトを変える PR は、レビューの対象にしている。

## 手順10：プレビュー

`infra/setup-preview.sh` が、App Hosting の `web-preview` を本番と同じ Web アプリで作り、その URL を承認済みドメインに加える。`.github/workflows/preview.yml` が毎回呼ぶので、人が実行する必要はない。

## 手順11：教員の権限

議論を作れるのは、teacher claim を持つ教員だけ。管理者が、相手が一度 Google でログインしたあとに付ける。

```bash
node scripts/teacher-access.mjs --project "$PROJECT_ID" --email <メールアドレス> --action inspect
node scripts/teacher-access.mjs --project "$PROJECT_ID" --email <メールアドレス> --action grant
```

詳しい手順と、失敗したときの確かめ方は [MVPロール設計の「本番で教師権限を付ける手順」](mvp-roles.md#本番で教師権限を付ける手順)にある。

## 手順12：セッションの保持期間（TTL）

```bash
bash infra/setup-session-security.sh --plan    # 何を変えるかを表示するだけ
bash infra/setup-session-security.sh --apply   # 承認された本番反映のときだけ
```

`sessions` と `securityEvents` の `deleteAt` に TTL を付け、失効したログインセッションと監査記録を30日後に消す。ログインの有効性は TTL に頼らず、API が毎回判定する。

**いまの状態（2026-11-09）**：TTL の設定は0件（まだ `--apply` していない）。

## CI とデプロイ

| ワークフロー | 動くとき | すること |
|---|---|---|
| `ci` | PR、`deploy` からの呼び出し | `scripts/ci-changes.sh` が文書だけの PR を判定して `test` を省く。それ以外は `bash scripts/dev.sh check`（手元と同じ検査） |
| `deploy` | `main` への push（文書だけの変更では動かない） | CI を通ったコミットを、Rules → API → 画面の順に反映し、最後に本番の URL を確かめる |
| `deploy`（手動） | Run workflow | ロールバック。過去にデプロイが成功したコミットだけを、Rules・API・画面ごと再デプロイする |
| `preview` | `web/` を変えた PR（同じリポジトリのブランチ） | 画面だけを `web-preview` に出す。ワークフローとスクリプトは `main` のものを使い、PR からは `web/` だけを使う |

**`deploy` の中身**（`.github/workflows/deploy.yml`）：

1. 必須の Variables がそろっているか、`API_MIN_INSTANCES` が 0〜2 かを確かめる。
2. Firestore・Storage の Rules と索引：`node infra/deploy-rules.mjs --apply`。Firebase に登録されたバケットだけを対象にし、一覧を読めなければ止まる。
3. API：リポジトリのルートで `api/Dockerfile` からイメージを作り、Artifact Registry に push して Cloud Run にデプロイする。
4. 画面：`firebase deploy --only apphosting:web`。
5. コミット・API のリビジョン・最小インスタンス数を、実行結果のサマリーに記録する。
6. 本番の `https://web--<PROJECT_ID>.asia-east1.hosted.app/api/healthz` が `{"ok":true,"gemini":"gemini"}` を返すまで、最大2分くり返し確かめる。画面・`/api` の転送・API・Gemini の設定がそろっていることを表す（生成が成功するかは表さない）。

- **文書だけの変更**：`**/*.md`・`docs/**`・`LICENSE` だけを変えた push では、`deploy` は動かない。条件は `scripts/ci-changes.sh` と同じで、`tests/config.test.sh` が一致を確かめる。
- **続けてマージしたとき**：同時に2つのデプロイは走らない。待っている実行は、後から来た実行に置き換えられる（後の実行は前のコミットも含む）。
- **ロールバック**：GitHub の「Actions」→「deploy」→「Run workflow」で、ref に直前の正常なコミットを入れる。Rules・API・画面を同じコミットにそろえて戻す。

### API のイメージ

- `api/Dockerfile` は、API と `speech/` をまとめてビルドする。Python の仮想環境、固定版の推論ライブラリ、SHA-256 を確かめたモデルを、ビルドのときに入れる（起動のときに取得しない）。非 root で動かす。
- 送るファイルは `api/Dockerfile.dockerignore` の許可リストだけにする。端末内の音声・認証情報・デモ用の Web を入れない。
- 手元でビルドを確かめるときは、リポジトリのルートで `docker build -f api/Dockerfile -t <検証用イメージ名> .` を実行する。
- 0台から起動すると、モデルの読み込みを待つ。授業・デモ・審査の時間帯は、最小インスタンス数を 1 にする（次の節）。

## 運用

### デモ・審査の前

API の最小インスタンス数を 1 にして、0台からの遅い起動を避ける。Variable にも同じ値を入れておくと、その後のデプロイでも 1 が保たれる。

```bash
source infra/env.sh
gh variable set API_MIN_INSTANCES --body 1 --repo "$DEV_REPO"
gcloud run services update api --min-instances=1 --region "$REGION" --project "$PROJECT_ID"
```

終わったら、同じ2つを `0` で実行する。1台を常に動かす間は、その分の費用がかかる。

### 費用の監視と上限

| 層 | いまの状態（2026-11-09） |
|---|---|
| 予算アラート | 2本（手順2）。通知だけで、課金は止めない |
| 支出上限（自動停止） | 付けていない |
| Vertex AI のクォータ | 独自の上限（override）は0件 |
| アプリの制限 | 利用者・部屋・グループごとの回数制限（[API と認可](api.md)）。作成とテーマ案は教員だけ。プロジェクト全体の1日の上限と、Gemini の出力トークンの上限（`maxOutputTokens`）はない |
| 計算資源 | Cloud Run の `api` は最大2台、App Hosting の `web` は最大4台。プレビューとデモは別に動く |

**金額で止めたいとき**：予算に支出上限（spend cap）を付けると、対象サービスの新しい利用を止められる（[公式の説明](https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps)）。

- 対象には、Vertex AI（Gemini Enterprise Agent Platform、`aiplatform.googleapis.com`）と Cloud Run が含まれる。
- 1つの予算で、1つのプロジェクトの1つのサービスだけを止める。期間は月ごと（1日に戻る）。
- クレジットを差し引く前の見込み額で判定する。止まるまでに遅れがあり、その間の超過分は課金される。上限は、本当の上限より少し低く設定する。
- 止まっている間、そのサービスは本番でも使えない（Vertex AI なら、Gemini の分析がすべて失敗する）。予算の編集で解除できる。
- 設定には、請求先アカウントの管理者などの権限が要る。設定するかと金額は、代表者が決める。

### 本番の確認

人が本番の URL で確かめる手順は [本番の URL で通しを確かめる手順](production-check.md) にある。`deploy` の最後の確認は、設定がそろっていることだけを表す。

## 手順13：提出用リポジトリへの反映

```bash
git clone "https://github.com/${DEV_REPO}.git" dev
git clone "https://github.com/${SUBMIT_REPO}.git" submit
bash dev/scripts/submit.sh dev submit main
# 表示された一覧（A=追加 M=変更 D=削除）を確認してから
git -C submit commit -m "Submission $(git -C dev rev-parse --short main)" && git -C submit push origin main
```

`scripts/submit.sh` は次の順で動く。commit と push は、人が一覧を確かめてから行う（エージェントは `submit.sh` の実行までにとどめる）。

1. **検証**：両方のパスが Git リポジトリの最上位か、提出用の origin が運営のリポジトリか、指定したコミットがあるか、提出先に未コミット・未追跡のファイルがないかを確かめる。どれかが違えば、何も変えずに止まる。
2. **一時ディレクトリで検査**：.env・鍵ファイル・鍵の形式、password や token などへの値の代入、App Hosting 用 YAML の平文の値を探す。README.md と LICENSE がなければ止まる。
3. **反映**：検査を通ったときだけ、提出先の作業ツリーを置き換える。前回の古いファイルは残らない。

人が確かめたテスト用のダミー値は、その行に `submit-allow:` と書けば通る（通した行の数は毎回表示される）。締切は 11/10 19:00 で、過ぎると提出用リポジトリは読み取り専用になる。17:00 までに一度反映する。

## 確認チェックリスト

- [ ] クレジットが反映され、予算が2本ある
- [ ] `bash infra/setup-project.sh` が最後まで通った
- [ ] Authentication の Google が有効で、本番の URL が承認済みドメインにある
- [ ] `bash scripts/dev.sh serve` で起動し、参加コード `100001` で参加できる
- [ ] `bash infra/setup-github.sh` を実行した（`main` のルールを設定できなかった場合は、その表示を確かめた）
- [ ] App Hosting の `web` が asia-east1 にあり、`web/apphosting.yaml` の `API_ORIGIN` が本物の URL になっている
- [ ] `main` への push で `deploy` が最後の確認まで成功する
- [ ] 教員のアカウントに teacher claim を付け、教員のホームから議論を作れる
- [ ] [本番の URL で通しを確かめる手順](production-check.md)が通る
- [ ] 提出スクリプトが OK を出し、提出用リポジトリに最終版と作品の URL が入っている

## よくあるエラー

| 症状 | 原因 | 対処 |
|---|---|---|
| App Hosting の作成でリージョンのエラー | 東京など非対応のリージョンを指定した | asia-east1 を指定する |
| `gcloud projects create` が失敗する | プロジェクト ID が使用済み | 末尾に数字を足し、`infra/env.sh` と Variables を直す |
| 予算の通知が来ない | クレジット控除後の金額で計算している | 予算1に `--credit-types-treatment=exclude-all-credits` が付いているか確かめる |
| `deploy` が「Variables が未登録です」で止まる | 必須の Variables が空 | `infra/setup-deployer.sh` の表示どおりに登録する |
| `deploy` が「API_MIN_INSTANCES は 0〜2」で止まる | Variable の値が整数でないか、最大の2台を超える | 0・1・2 のどれかにする（未登録なら 0） |
| `deploy` の auth で unauthorized | `WIF_PROVIDER`・`DEPLOYER_SA` の登録違い、または `DEV_REPO` の綴り違い | `setup-deployer.sh` の表示どおりに登録し直す |
| `deploy` の最後の確認が失敗する | API が起動しない、`API_ORIGIN` の誤り、Gemini の設定が空、など | 各手順のログと Cloud Run のログを見る。必要ならロールバックする |
| 文書を変えたのに `deploy` が動かない | 文書だけの変更では動かない（正常） | そのままでよい |
| 文書だけの PR で `test` が skipped になる | 変更判定で重い検査を省いた（正常） | そのままマージしてよい。必須チェックでは成功として扱われる |
| 画面から API を呼ぶと 404 | `web/apphosting.yaml` の `API_ORIGIN` が違う | 手順6の URL を書いて push する |
| Gemini の呼び出しが PERMISSION_DENIED | `GEMINI_MODEL`・`VERTEX_LOCATION` が未設定か対応先と不一致、または `api-runtime` に Vertex AI の権限がない | Variables と手順3のロールを確かめる |
| ログインで `auth/unauthorized-domain` | その URL のドメインが未承認 | 手順4の承認済みドメインに加える |
| 教員なのに参加コードの入力が開く | teacher claim がない、または付けたあとログインし直していない | 手順11で確かめ、ログインし直してもらう |
| `setup-github.sh` で `main` のルールを設定できない | gh のアカウントがリポジトリの管理者ではない | オーナーが実行し直す |
| ロールバックが「デプロイが成功していません」で止まる | 指定したコミットは過去にデプロイが成功していない | `deploy` の実行一覧で成功したコミットを確かめて指定し直す |
| 提出スクリプトが NG で止まる | 秘密情報らしき値、または提出先の未追跡ファイル | 表示された行を直す。テスト用のダミーなら `submit-allow:` を付ける |

## 後片付け

| いつ | すること |
|---|---|
| 11/10 の提出のあと | AI 用の鍵を、デモに使う分を残してすべて消す（[credentials](credentials.md)） |
| デモが終わったとき | `API_MIN_INSTANCES` と Cloud Run の最小インスタンス数を 0 に戻す。使わないデモ用のサービスとタグを消す |
| 11/29 の GDG DevFest Tokyo のあと | 動かし続けないなら `gcloud projects delete "$PROJECT_ID"`。サービスアカウント・鍵・WIF も一緒に消え、30日後に完全に削除される |
