# DevFest Hackathon 2026 チーム167 インフラ構築・開発手順書（v4 の写し）

> 正本はチームドキュメントの「インフラ構築手順書」タブ（https://docs.google.com/document/d/1zHg74msQ1xBgsautfcQNsv-dDlQcO4WqzbV0ZDNnv5A/edit?tab=t.t1975sujc4nn）。エージェントは正本を読み、読めなかったときだけこの写しを読む。この写しは 2026-11-05 時点の正本と同じ内容で、メンバーのメールアドレスだけを伏せている。

## プロジェクトの背景と目的

チーム167は DevFest Hackathon 2026 に、教育カテゴリで「AI協調型グループディスカッション支援プラットフォーム」を出展します。2026-11-10 19:00 の提出締切までに、Google Cloud 上で一連の流れが動く作品を提出することが目標です。

大学のゼミやグループ学習では、発言が一部の人に偏り、少数意見が埋もれ、合意したつもりでも中身がずれていることがあります。既存の会議 AI は発言の記録や要約が中心で、発言されなかった意見や合意のずれは拾えません。

**MVP の3機能**（この3つが通しで動くことを最優先にします）

1. **事前意見収集**：議論の前に、全員の意見を非公開で集める。
1. **未検討論点の検出**：事前意見と実際の議論を Gemini で照合し、まだ取り上げられていない論点を司会者に提案する。司会者が承認したものだけ全員に表示する。
1. **合意の実態検証**：結論が出たときに各自が合意内容を一文で書き、Gemini がずれを可視化する。

### 守るべき条件

| 項目 | 運営の条件 | 対応 |
|---|---|---|
| カテゴリ | 5カテゴリのどれか。カテゴリ外は審査対象外 | 「教育」で出す |
| 実行基盤 | App Engine・Compute Engine・GKE・Cloud Run・Firebase App Hosting・Firebase Hosting の1つ以上 | Firebase App Hosting（画面）＋ Cloud Run（API） |
| 提出先 | 運営の公開リポジトリ。審査はその中身だけで行う。Actions と Pages は使えない | 開発は公開の開発用リポジトリで行い、最終版を scripts/submit.sh で反映する |
| 秘密情報 | 公開リポジトリなので鍵やパスワードをコミットしない | 提出スクリプトが自動で検出して止める |
| 予算 | 運営配布の Google Cloud クレジット。使い切ると登録したカードに課金される | 予算アラートを2本設定する |

**主な日程**：11/10 19:00 コードフリーズ・提出締切 → 11/11〜13 審査員の事前審査（提出物だけで審査）→ 11/14 Regional Day → 11/27 Demo Day → 11/29 GDG DevFest Tokyo。

## 審査基準への対応方針

審査は8項目を各0〜3点、合計24点で行います。各項目について、動くものと証拠を提出物に残します。

| 審査項目 | 何で示すか | 証拠を置く場所 |
|---|---|---|
| 1a Google 技術が中核で機能 | Gemini が未検討論点と合意のずれを見つけ、Firestore が全員の画面をリアルタイムに同期する | デモ動画、README の構成図 |
| 1b 採用理由の説明 | 下の「技術の選定理由と制約」の表を README に載せる | README |
| 2a 一連の流れが動く | 手順10の通しテスト（司会者1人＋参加者3人） | E2E テストの結果、デモ動画 |
| 2b 目的を達成できる UI・UX | 参加者はスマホで参加コードから30秒以内に参加できる。司会者は次の一手を1画面で判断できる | スマホでの操作録画 |
| 2c 安全性・拡張性・保守性 | 非公開意見を守る Rules とそのテスト、鍵を使わない CI、CI と同じ検査を手元で1つのコマンドで実行できること、AGENTS.md と CONTRIBUTING.md の開発ルール | CI のログ、README、CONTRIBUTING.md |
| 3a 課題が具体的 | 教育の場面に絞った課題を示す | README、ピッチ |
| 3b 機能が課題解決に有効 | 下の4つの指標を保存データから計算して見せる | 結果画面、デモ動画 |
| 4a デモ・話の構成 | 手順10のデモシナリオ（3分） | ピッチ |

### 4つの指標の定義

指標は API が計算し、rooms/{部屋}/results に保存します（雛形の api/src/metrics.ts）。Gemini の判定を使う値には「Gemini による推定」、モックのときは「デモデータ」と画面に表示し、実測の改善効果とは区別します。

| 指標 | 計算方法 | 使うデータ | データがないとき |
|---|---|---|---|
| 意見の反映率 | 事前意見から取り出した論点のうち、議論中の発言で取り上げられた論点の割合 | 事前意見、発言、Gemini の判定 | 事前意見が0件なら「データなし」 |
| 認識一致度 | 合意の一文を意味でまとめたとき、最も大きなまとまりに入った人の割合 | 合意の一文、Gemini のまとめ | 回答が2人未満なら「データなし」 |
| 参加の公平性 | 1 −（参加者ごとの発言数のジニ係数）。全員同じ数なら 100% | 発言 | 参加者2人未満、または発言0件なら「データなし」 |
| 介入の有効率 | 承認した提案のうち、承認後の発言で取り上げられた割合 | 承認済みの提案、承認後の発言、Gemini の判定 | 承認した提案が0件なら「データなし」 |

### 技術の選定理由と制約

| 技術 | 選んだ理由 | 欠点・制約 | 対策 |
|---|---|---|---|
| Gemini（Vertex AI 経由） | 日本語の議論から論点を取り出せる。構造化出力で JSON を直接受け取れる。API キーなしで呼べる | 応答に数秒かかる。出力が毎回少し変わる。費用がかかる | 提案は司会者の承認制にする。分析は1部屋30秒に1回まで。temperature 0 で揺れを抑える |
| Cloud Firestore | 参加者のスマホに変化を即時に届けられる。Rules で読める範囲をデータベース側で強制できる | 結合ができない。Rules 内の get は読み取りとして課金される | 部屋単位のサブコレクションにする。Rules はエミュレータで自動テストする |
| Cloud Run | Gemini 呼び出しや集計など、クライアントに置けない処理を動かせる。使わない時間は0台まで縮む | コールドスタートで最初の応答が遅い | デモの時間帯だけ最小インスタンスを1にする |
| Firebase App Hosting | Next.js をサーバー描画込みで公開できる | 東京リージョンがない（台湾を使う） | データと API は東京に置く |
| Firebase Authentication | 参加者は匿名ログインですぐ参加でき、司会者は Google でログインする | 匿名アカウントは端末を変えると別人になる | 同じブラウザでの再接続を前提にし、手順10でテストする |

## 全体構成

- 参加者・司会者（スマホ・PC のブラウザ）→ **App Hosting**（Next.js、asia-east1）→ /api を **Cloud Run**（API、asia-northeast1）へ転送 → **Gemini**（Vertex AI、global）と **Firestore**（asia-northeast1）
- 画面のリアルタイム更新は、ブラウザが Firestore を直接購読する（Rules で読める範囲を制限）
- ブラウザは常に同じオリジンの /api を呼ぶので CORS の設定は不要

**ブランチの流れ**：作業ブランチ（<種類>/<内容>）→ main への PR（CI が自動で検証）→ squash merge で本番に自動反映（「開発のルール」の節）。

**変数**は雛形の infra/env.sh に1か所でまとめています。このチームの開発用プロジェクトは devfest2026-t167 です。Cloud Run・Firestore は東京、App Hosting は台湾、Gemini の接続先は global に分けます。Gemini の global 接続先では処理地域を日本国内に限定できません（公式の接続先情報：https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/locations）。プロジェクト ID が使用済みで作れないときは末尾に数字を足し、infra/env.sh と GitHub の Variables（手順8）を直します。ワークフローには ID を直書きしていません。

## 構築の順番

全体は次の順で進めます。各手順の詳細はこの後に書いています。

1. クレジットの引き換えと請求先アカウント（手順1）
1. プロジェクトの作成と予算アラート（手順2）
1. 基盤の作成：bash infra/setup-project.sh（手順3）
1. Firebase の追加と Authentication（手順4）
1. 開発用リポジトリを雛形から作り、ローカルで動かす（手順5）
1. App Hosting のバックエンドを作る（手順6）
1. API の URL を画面の設定に書く（手順6）
1. デプロイ用サービスアカウントと WIF：bash infra/setup-deployer.sh（手順8）
1. GitHub の設定（squash だけ、マージ後にブランチを削除、main のルール）：bash infra/setup-github.sh（手順8）
1. GitHub の Variables を登録して main に push する。CI がルール → API → 画面の順に初回デプロイする（手順8）
1. メンバーと AI ツールの権限（手順9）

## 手順1：クレジットの引き換えと請求先アカウント

運営から代表者に届いたクレジットコードを、請求先アカウントに登録します。コードは1回しか使えず、チーム外への共有や公開の場への掲載は禁止です。**コードそのものはこの手順書に書かないでください。**

1. [Google Cloud コンソール](https://console.cloud.google.com/) に、個人の Gmail アカウントでログインする。大学アカウントは組織の制限でプロジェクトや請求先を作れない場合がある。
1. 「お支払い」から請求先アカウントを作り、支払い方法を登録する。クーポンを使うには有料アカウントへのアップグレードが必要。クレジットの範囲内なら費用はかからない。
1. [https://cloud.google.com/redeem](https://cloud.google.com/redeem) を開き、プロモーションコードを入力する。
1. 「お支払い」→「クレジット」で反映を確認し、金額と有効期限を控える。反映には最大15分ほどかかる。

```
gcloud billing accounts list
export BILLING_ACCOUNT="XXXXXX-XXXXXX-XXXXXX"
export CREDIT_AMOUNT="10000JPY"   # 控えたクレジット額。通貨は請求先アカウントと同じにする
```

## 手順2：プロジェクトの作成と予算アラート

```
source infra/env.sh   # 開発用リポジトリを作る前なら、雛形の infra/env.sh の中身を貼り付ける
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

予算の既定ではクレジットを差し引いた後の金額で計算するため、クレジットで相殺されている間は通知が来ません。予算1をクレジット控除前で計算するのはそのためです。予算アラートは通知するだけで、課金は止めません。

## 手順3：基盤の作成

```
bash infra/setup-project.sh
```

API の有効化、Firestore（asia-northeast1）、Artifact Registry、Cloud Run 用のサービスアカウント api-runtime（Firestore と Vertex AI を使う権限）を作ります。同じプロジェクトに2回実行しても壊れません。

## 手順4：Firebase の追加と Authentication

```
firebase login --no-localhost
firebase projects:addfirebase "$PROJECT_ID"
firebase apps:create WEB "t167-web" --project "$PROJECT_ID"
```

[Firebase コンソール](https://console.firebase.google.com/) の「Authentication」→「Sign-in method」で、**Google**（司会者用）と **匿名**（参加者用）を有効にします。手順6で App Hosting の URL が決まったら、「Settings」→「承認済みドメイン」にそのドメインがあるか確認し、なければ追加します。

## 手順5：開発用リポジトリを雛形から作る

1. GitHub で genellect/devfest2026-t167 を Public で作り、メンバーを Collaborator に招待する。公開リポジトリなので、鍵やトークンは置かない。
1. 雛形 df-2026-t167-dev.zip を展開し、その中身で初回コミットを作って main に push する。
1. 下のコマンドで準備して起動し、http://localhost:3000 で参加コード DEMO01 を入れて参加できることを確かめる。

```
unzip df-2026-t167-dev.zip && cd df-2026-t167-dev
git init -b main && git add -A && git commit -m "Start from verified scaffold"
git remote add origin "https://github.com/${DEV_REPO}.git" && git push -u origin main
bash scripts/dev.sh setup    # 依存を lockfile どおりに入れ、web/.env.local を用意する
bash scripts/dev.sh doctor   # Node.js・Java・依存・Firebase CLI・ブラウザの準備を確かめる
bash scripts/dev.sh serve    # エミュレータ・テストデータ・API・画面をまとめて起動（Ctrl-C で全部止まる）
```

**雛形に入っているもの**

| 場所 | 中身 |
|---|---|
| web/ | Next.js。参加コードでの参加、非公開意見の提出画面。/api の転送設定、Playwright の E2E |
| api/ | Express + TypeScript。手順7の全エンドポイント、Gemini（Vertex AI とモック）、4つの指標、Dockerfile、結合テスト |
| firebase/ | Firestore Rules、そのテスト13件、共有テストデータ（seed）、固定バージョンの Firebase CLI |
| infra/ | env.sh、setup-project.sh、setup-deployer.sh、setup-ai-access.sh |
| scripts/ | dev.sh（開発の入口：setup・doctor・serve・check・pr）、ci-changes.sh（CI の変更判定）、submit.sh（提出）、claude-gcp-login.sh（AI ツールのログイン） |
| .github/ | ci.yml（PR ごとの検証）、deploy.yml（main へのデプロイとロールバック）、PR テンプレート |
| AGENTS.md・CLAUDE.md・CONTRIBUTING.md | AI エージェントの指示、Claude Code 向けの補足、開発のルール（「開発のルール」の節） |
| .claude/ | クラウド環境のセットアップスクリプト（cloud-setup.sh）と、gcloud に自動でログインするフック。Codex 用は .codex/setup.sh、手元に何も入れずに開く環境は .devcontainer |
| tests/ | submit.sh の回帰テスト16件、ci-changes.sh の回帰テスト9件、dev.sh pr の回帰テスト9件 |

ローカルでは本物の GCP を使いません。Auth と Firestore はエミュレータ、Gemini はモックで動きます。GEMINI_MOCK_FAIL=1 bash scripts/dev.sh serve で起動すると、Gemini が失敗したときの動きを確認できます。PR を出す前には bash scripts/dev.sh check で CI と同じ検査を通します（PR は bash scripts/dev.sh pr で出します。「開発のルール」の節）。本物の Gemini で試すときは、プロジェクトの編集者の権限で gcloud auth application-default login をしてから GEMINI_MOCK=0 bash scripts/dev.sh serve で起動します。Firestore と Auth はエミュレータのままで、Vertex AI だけ本番のプロジェクトを使います。Gemini の接続先は infra/env.sh の VERTEX_LOCATION=global、モデルは GEMINI_MODEL=gemini-3.5-flash を使います。Windows では WSL の中で動かします。手元に Node.js と Java を入れたくない場合は、雛形の .devcontainer を VS Code の Dev Containers か GitHub Codespaces（ブラウザ版ではなく VS Code から）で開きます。Firebase CLI は firebase/ の lockfile で固定したものを、手元でも CI でも npm --prefix firebase run fb -- で実行します。

## 手順6：App Hosting のバックエンドと API の URL

```
npm --prefix firebase run fb -- init apphosting --project "$PROJECT_ID"
```

対話では、バックエンド ID に web、リージョンに asia-east1、アプリのルートに web を指定し、手順4の Web アプリを紐づけます。生成された firebase.json の変更をコミットします。

続いて、web/apphosting.yaml の API_ORIGIN を本物の URL に書き換えます。Cloud Run の URL はプロジェクト番号で決まるので、API をデプロイする前に書けます。手順8の setup-deployer.sh の最後にもこの URL が表示されます。

```
NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
sed -i "s/PROJECT_NUMBER/${NUMBER}/" web/apphosting.yaml
git commit -am "Set API_ORIGIN" && git push
```

## 手順7：API の認可とデータ

非公開の事前意見は本人と API しか読めません。司会者と他の参加者に届くのは、API が持ち主を伏せて要約した論点だけです。Firestore Rules（firebase/firestore.rules）と API の両方で確認します。API は Admin SDK を使うので Rules を通らないためです。

**エンドポイントごとの認可**

| エンドポイント | ログイン | 部屋の所属確認 | 司会者の確認 | フェーズ |
|---|---|---|---|---|
| GET /healthz | 不要 | なし | なし | なし |
| POST /rooms | 必要（匿名は不可） | なし（作成前なので） | なし（作成者が司会者になる） | なし |
| POST /rooms/join | 必要（匿名で可） | なし（参加前なので。参加コードで部屋を特定） | なし | closed 以外 |
| POST /rooms/{部屋}/phase | 必要 | あり | あり | 1つずつ順に進める |
| POST /rooms/{部屋}/analyze | 必要 | あり | あり | discussing |
| POST /rooms/{部屋}/insights/{提案}/approve | 必要 | あり | あり | なし |
| POST /rooms/{部屋}/consensus/analyze | 必要 | あり | あり | consensus |

エラーは 401（未ログイン）、403（所属・役割が違う）、404（参加コードや部屋がない）、409（フェーズ違い・分析中・処理済み）、429（30秒以内の再分析）、503（Gemini の失敗）で返し、本文は { "error": { "code", "message" } } の形にそろえています。

**分析の30秒制限と結果の扱い**：分析を始めるときに、部屋ドキュメントにトランザクションで jobId と開始時刻を書きます。Cloud Run が複数台に増えても、同時に2つの分析は走りません。分析中の再実行は 409、30秒以内の再実行は 429 と残り秒数を返します。Gemini の結果を保存するときは jobId が今の分析と一致するかを確かめ、遅れて返った古い結果は捨てます。Gemini が失敗しても発言や意見は Firestore に直接書くので、議論は止まりません。どれも API の結合テストで確認済みです。

**Rules のテスト**（firebase/test/rules.test.mjs、13件）：他人と司会者は非公開意見を読めない、別室と未ログインは読めない、参加コードは誰も読めない、自分を司会者にできない、決められたフェーズでだけ本人名義で書ける、懸念の欄は300字以内の文字列だけ、参加者は承認済みの提案だけ読める、などを確かめます。CI が毎回実行し、結果はログに残ります。

## 手順8：CI/CD

```
bash infra/setup-deployer.sh
bash infra/setup-github.sh    # gh でログインしたリポジトリ管理者が1回実行する
```

GitHub Actions 用のデプロイ用サービスアカウントと WIF（鍵を使わない認証）を作り、GitHub に登録する値を表示します。開発用リポジトリの「Settings」→「Secrets and variables」→「Actions」→「Variables」に、表示された6つの PROJECT_ID・REGION・VERTEX_LOCATION・GEMINI_MODEL・WIF_PROVIDER・DEPLOYER_SA を登録します。GEMINI_MODEL は gemini-3.5-flash、VERTEX_LOCATION は global にします。2026-11-05 に公式モデル情報（https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-5-flash）で global の Standard PayGo への対応を確認し、依頼者が承認しました。Cloud Run・Firestore の REGION=asia-northeast1 と分け、Provisioned Throughput は追加しません。

**GitHub の設定**（infra/setup-github.sh）：マージは squash だけにし、マージしたブランチを自動で削除し、auto-merge を使えるようにします。鍵を含む push を GitHub が止める secret scanning と push protection も有効にします（公開リポジトリでは無料）。main には、PR 経由でだけ更新でき、CI の test の成功が必須で、force push と削除ができないルールを設定します。レビューの承認は必須にしません。開発用リポジトリは公開なので、Free プランでもルールを設定できます。gh のアカウントに管理者権限がなく設定できなかった場合は、スクリプトがそう表示して続行します。ルールが設定されるまでも、main に直接 push せず、CI の成功を確かめてからマージする運用は同じです。

**CI**（.github/workflows/ci.yml）：PR のたびに、まず changes ジョブが変更したファイルを調べます（scripts/ci-changes.sh）。文書だけの変更（*.md、docs/、LICENSE）なら test ジョブを省きます。省いたジョブは必須チェックでは成功として扱われます。それ以外の変更と main への push では、test ジョブが bash scripts/dev.sh check を実行します。lint・型チェック・単体テスト・提出スクリプトと変更判定の回帰テスト・ビルドのあと、エミュレータ上で Rules のテスト・API の結合テスト・E2E を行います。手元の check とまったく同じ検査なので、手元で通れば CI でも通ります。同じ PR の新しい実行は古い実行を取り消し、main の実行は取り消しません。失敗したら Playwright のレポートが7日間保存されます。

**デプロイ**（.github/workflows/deploy.yml）：main に push されると CI を実行し、通ったときだけ Firestore のルール → API（Cloud Run）→ 画面（App Hosting）の順に、同じコミットからデプロイします。同時に2つのデプロイは走りません。終わるとコミット・API のリビジョンが実行結果のサマリーに記録されます。初回のデプロイもこの流れで行われます。

**ロールバック**：GitHub の「Actions」→「deploy」→「Run workflow」で、ref に直前の正常なコミットを入れて実行します。ルール・API・画面を同じコミットにそろえて戻すので、新しい画面と古い API が食い違うことはありません。過去にデプロイが成功していないコミットを指定すると、何もせずに止まります。どのコミットが正常だったかは、過去の実行結果のサマリーで確認します。

## 手順9：メンバーと AI ツールの権限

開発速度を優先し、メンバー全員と AI ツール用のサービスアカウントをプロジェクトの編集者にします。

```
for MEMBER in <メンバー1のGmail> <メンバー2のGmail>; do   # 実際のアドレスはチームドキュメントの正本にある
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="user:${MEMBER}" --role=roles/editor --condition=None
done
```

- **手元の PC の AI ツール**（Claude Code・Codex など）：各自が gcloud auth login と gcloud auth application-default login をしておけば、AI ツールはその権限で gcloud や Admin SDK を使える。追加の設定は不要。
- **クラウドの Claude Code**：bash infra/setup-ai-access.sh で AI 用サービスアカウントの鍵を作る。中身を Claude Code の環境設定（セッションのタイトルバーの環境メニュー →「Edit」）で、環境変数 GCP_SA_KEY として登録する。新しいセッションを開くと、雛形の .claude/settings.json に書いたフックが自動で gcloud にログインする。セットアップスクリプトからは環境変数を読めないので、フックでログインする。

鍵は提出スクリプトが検出して止めるので、誤って提出用リポジトリに入ることはありません。ハッカソンが終わったら、プロジェクトの削除と一緒に消えます。

## 開発のルール（人と AI エージェント）
初心者の contributor は、リポジトリの docs/contributor-preview-guide.md（文書更新 PR の反映後）で、PR の作成、プレビューの確認、本番反映の依頼と確認を順に行う。クラウドの権限や請求の設定は担当者が済ませる。

ルールの正本は雛形の CONTRIBUTING.md（人向け）と AGENTS.md（エージェント向け）で、ここはその要約です。ルールを変えるときは、この2つを同じ PR で更新し、食い違いを残さないようにします。

**役割**

| 役割 | 担当 | 責任 |
|---|---|---|
| メンバー | チームの3人 | 実装、PR の作成、プレビューの確認。本番反映は Yuto Matsui の事前承諾を受けた担当者が行う |
| AI エージェント | Claude Code、Codex など | 依頼者の指示による実装と検査。成果物の責任は依頼者が持つ |

**開発の流れ**

1. git fetch origin main のあと、最新の origin/main からブランチを作る。名前は <種類>/<内容>。種類は feat・fix・docs・test・chore・ci のどれか（例：feat/consensus-gap-view）。AI ツールが名前を決める場合は claude/・codex/ のままでよい。
1. 1つの PR では1つの目的だけを扱う。関係するテストと文書を同じ PR で更新する。たとえば API のエンドポイントを変えたら、画面の呼び出し、API の結合テスト、README の認可の表も変える。
1. コミットしたら bash scripts/dev.sh pr --no-merge を実行する。手元の検査（check --quick）、push、PR の作成を1回で行い、auto-merge は付けない。PR の本文には、背景・目的、検査とプレビューの結果、未確認のこと、スクリーンショットを書く。
1. main へのマージから自動デプロイまでを、まとめて「本番反映」と呼ぶ。本番反映を始める前に、必ず Yuto Matsui（GitHub：genellect）の承諾を得る。承諾はその PR の「本番反映」への1回とし、マージとデプロイで2回に分けない。CI・レビュー・プレビューの成功は承諾の代わりにならない。承諾待ちの間はマージせず、auto-merge も付けない。承諾後は Yuto Matsui または任された担当者が、CI の成功と必要なレビューを確認して本番反映を進める。Rules・ワークフロー・構築の変更はレビューを通す。

```
git switch -c feat/consensus-gap-view && git commit -am "feat(web): ずれの一覧を表示する"
bash scripts/dev.sh pr --no-merge  # 検査・push・PR。Yuto Matsui の本番反映の承諾を待つ
```

**AI エージェントの統制**（AGENTS.md）

- エージェントへの指示は AGENTS.md に1か所でまとめる。CLAUDE.md は冒頭の @AGENTS.md で読み込み、Claude Code 固有のこと（セットアップスクリプト、ブラウザの場所、Co-Authored-By 行を残すこと）だけを足す。ツールごとに指示を書き分けない。実装の前と PR を出す前に、毎回この手順書を読ませる。Claude も Codex も、Google Docs の接続でこの正本を読む。読めなかったときだけリポジトリの写し docs/infra-manual.md を読み、そのことを報告する。この手順書を変えた人は、関係するコードや運用ルールの変更と同じ PR で、同じ日に写しも更新する（メンバーのメールアドレスは写しに入れない）。写しだけを追いつかせるときは専用 PR にする。
- 常に守ることは5つだけにする。クレジットコード・鍵・トークンを書かない。非公開の事前意見を本人以外に出さない。実行していない検査を通ったと報告しない。本番反映は Yuto Matsui がその PR の本番反映を事前に承諾したときだけ行う。提出用リポジトリへの commit と push は人が行う。
- 依頼するときは、目的・変更してよい範囲・完了条件を書く。並行して動かすエージェントには、別々のブランチと git worktree を割り当て、同じファイルを編集させない。
- エージェントも PR を bash scripts/dev.sh pr --no-merge で出す。Yuto Matsui がその PR の本番反映を承諾した場合だけ、任された担当者が auto-merge またはマージを行う。main へのマージから自動デプロイまでを本番反映として、承諾は1回にまとめる。確認していない変更や、承諾のない本番反映を進めない。
- 報告では「実装した」「CI が通った」「本番に反映した」「本番の URL で動作を確かめた」を分けて書かせる。
- 引き継ぎは PR の説明に書く。セッションごとの引き継ぎ文書は作らない。
- 文書とコードが食い違っていたら、コードと設定で事実を確かめ、直す前に依頼者に確認する。

## 手順10：完成判定テストとデモシナリオ

**10-1. 通しテスト**（本番の URL で、端末4台：司会者は PC、参加者3人はスマホ）

1. 司会者が Google ログインして部屋を作り、参加コードと QR を表示する。
1. 参加者3人がスマホで参加コードを入れ、30秒以内に匿名で参加できる。
1. 参加者がそれぞれ非公開の事前意見を書く。お互いの意見も、司会者からも本文が見えない。
1. 司会者が議論フェーズに進め、参加者が発言する。発言は全員の画面に数秒以内に出る。
1. 司会者が分析を実行すると、事前意見にあってまだ議論されていない論点が、司会者にだけ提案される。分析中はボタンが押せず、30秒以内にもう一度押すと待ち時間が出る。
1. 司会者が承認すると、参加者の画面にも提案が出る。
1. 合意フェーズで3人が合意内容を一文で書くと、ずれの分析と4つの指標が結果画面に出る。

**10-2. 拒否・障害のテスト**

| テスト | 期待する結果 | 確かめ方 |
|---|---|---|
| 参加者 A が参加者 B の非公開意見を読む | 拒否される | Rules のテスト（自動） |
| 別の部屋の参加者がこの部屋を読む | 拒否される | Rules のテスト（自動） |
| 参加者が分析や承認の API を呼ぶ | 403 | API の結合テスト（自動） |
| 分析の二重実行、遅れて返った古い結果 | 409、古い結果は保存されない | API の結合テスト（自動） |
| Gemini の失敗 | 503。「AI の提案は一時停止中」と表示され、議論は続けられる | API の結合テスト（自動）と手動 |
| スマホを機内モードにして30秒後に戻す | 自動で再接続し、その間の発言が表示される | 手動 |
| 同じブラウザで再読み込みする | 同じ参加者として部屋に戻る | 手動 |

自動のものは CI が毎回実行します。手動のものは結果を README に書きます。

**10-3. デモシナリオ**（3分、司会者1人＋参加者3人）

1. 0:00〜0:30：課題の提示。「全員賛成」のはずの会議で、実は全員が違うことに賛成していた例を見せる。
1. 0:30〜1:00：参加者3人がその場で参加コードから参加し、非公開で意見を書く。
1. 1:00〜1:45：議論中に AI が「2人が挙げた『AI 利用の透明性』がまだ議論されていません」と司会者に提案し、承認すると全員に表示される。
1. 1:45〜2:30：合意フェーズ。3人とも「賛成」なのに、一文にすると許可範囲が3通りに分かれていることが可視化される。
1. 2:30〜3:00：4つの指標と、Gemini・Firestore・Cloud Run・App Hosting がそれぞれ何を担っているかを構成図で示す。

デモの前に gcloud run services update api --min-instances=1 --region "$REGION" --project "$PROJECT_ID" でコールドスタートを防ぎ、終わったら 0 に戻します。11/11〜13 の事前審査は提出物だけで行われるので、同じ流れの動画を README に載せます。

## 手順11：提出用リポジトリへの反映

```
git clone "https://github.com/${DEV_REPO}.git" dev
git clone "https://github.com/${SUBMIT_REPO}.git" submit
bash dev/scripts/submit.sh dev submit main
# 表示された一覧（A=追加 M=変更 D=削除）を確認してから
git -C submit commit -m "Submission $(git -C dev rev-parse --short main)" && git -C submit push origin main
```

scripts/submit.sh は、次の順で動きます。

1. **検証**：両方のパスが Git リポジトリの最上位か、提出用の origin が運営のリポジトリか、指定したコミットがあるか、提出先に未コミット・未追跡のファイルがないかを確かめる。どれかが違えば、何も変更せずに止まる。
1. **一時ディレクトリで検査**：コミットの内容を一時ディレクトリに書き出して検査する。.env・鍵ファイル・鍵の形式、password や token などへの値の代入（引用符なしの代入はコード以外のファイルで検出）、App Hosting 用 YAML の平文の値を探す。README.md と LICENSE がなければ止まる。
1. **反映**：検査を通ったときだけ、提出先の作業ツリーを置き換える。前回の古いファイルは残らない。commit と push は人が一覧を確認してから行う。

人が確認したテスト用のダミー値は、その行に submit-allow: と書けば通ります。通した行の数は毎回表示されます。締切は 11/10 19:00 で、過ぎると提出用リポジトリは読み取り専用になります。17:00 までに一度反映してください。

**提出用 README の構成**：雛形の README.md がこの順になっています。11/11〜13 の事前審査は提出物だけで行われるので、審査員が README だけで作品を判断できるように書きます。README には確かめた状態だけを書き、未完了のことは書きません。提出前に「提出前に記入」のコメントがある箇所を埋めます。

| 節 | 書くこと | 対応する審査項目 |
|---|---|---|
| 冒頭 | 作品名、一文の要約、作品の URL・デモ動画・構成・テスト・開発への参加へのリンクの行、何のアプリかを1段落で | 全体 |
| 課題と3つの機能 | 教育の場面の課題と、機能ごとに「すること」の表 | 3a、3b |
| アーキテクチャ | 構成図の画像、処理の流れを1行ずつ書いた図、部分ごとの実行場所と Gemini に送るものの表 | 1a |
| 設計の要点 | 「〜する。〜のため」の形で、決めたことと理由を1行ずつ | 1b、2c |
| 結果の整合性 | 「仕組み」と「防ぐこと」の表（分析の排他、古い結果の破棄、30秒制限、Rules、Gemini の障害時の動き） | 2c |
| 4つの指標 | 計算方法と、データがないときの表示 | 3b |
| 技術の選定理由と制約 | 「審査基準への対応方針」の表と同じもの | 1b |
| テスト | 検査ごとの件数と内容の表、本番の URL での通しテストと手動テストの結果 | 2a、2c |
| ディレクトリ構成 | ディレクトリごとの内容の表（各ディレクトリへのリンク付き） | 2c |
| ローカルで動かす・開発に参加する | bash scripts/dev.sh setup と serve の2行、CONTRIBUTING.md と AGENTS.md へのリンク | 2c |

## 確認チェックリストとトラブルシューティング

**構築の完了チェック**

- [ ] クレジットが反映され、予算が2本ある
- [ ] bash infra/setup-project.sh が最後まで通った
- [ ] Authentication の Google と匿名が有効
- [ ] bash scripts/dev.sh serve で起動し、参加コード DEMO01 で参加できる
- [ ] bash scripts/dev.sh check が通り、Yuto Matsui が本番反映を承諾したコードの PR が、CI の通過後に自動でマージされる
- [ ] bash infra/setup-github.sh を実行した（main のルールを設定できなかった場合は、その表示を確かめた）
- [ ] App Hosting の web が asia-east1 にあり、web/apphosting.yaml の API_ORIGIN が本物の URL になっている
- [ ] main への push で deploy が成功し、本番の URL で参加できる
- [ ] 手順10の通しテストが通る
- [ ] 提出スクリプトが OK を出し、提出用リポジトリに最終版と作品 URL が入っている

**よくあるエラー**

| 症状 | 原因 | 対処 |
|---|---|---|
| App Hosting の作成でリージョンのエラー | 東京など非対応のリージョンを指定した | asia-east1 を指定する |
| gcloud projects create が失敗する | プロジェクト ID が使用済み | 末尾に数字を足し、infra/env.sh と GitHub の Variables を直す |
| 予算の通知が来ない | クレジット控除後の金額で計算している | 予算1に --credit-types-treatment=exclude-all-credits が付いているか確認する |
| Actions の auth ステップで unauthorized | WIF_PROVIDER・DEPLOYER_SA の登録違い、または DEV_REPO の綴り違い | setup-deployer.sh の表示どおりに Variables を登録し直す |
| App Hosting のデプロイで権限エラー | 手順6のバックエンド作成前にデプロイした | 手順6を済ませてから main に push し直す |
| 画面から API を呼ぶと 404 | web/apphosting.yaml の API_ORIGIN が PROJECT_NUMBER のまま | 手順6の sed を実行して push する |
| Gemini 呼び出しが PERMISSION_DENIED | GEMINI_MODEL・VERTEX_LOCATION が未設定または対応先と不一致、もしくは実行主体に Vertex AI の権限がない | Variables 6つの登録と GEMINI_MODEL=gemini-3.5-flash・VERTEX_LOCATION=global、実行主体の Vertex AI 権限を確認する |
| ログイン画面で auth/unauthorized-domain | App Hosting のドメインが未承認 | 手順4の承認済みドメインに追加する |
| 文書だけの PR で test が skipped になる | 変更判定で重い検査を省いた（正常） | そのままマージしてよい。必須チェックでは成功として扱われる |
| setup-github.sh で main のルールを設定できない | gh でログインしたアカウントが、リポジトリの管理者ではない | オーナーが実行し直す。それまでは main に直接 push せず、gh pr checks --watch で確かめてからマージする |
| ロールバックが「デプロイが成功していません」で止まる | 指定したコミットは過去にデプロイが成功していない | deploy の実行一覧で成功したコミットを確かめて指定し直す |
| 提出スクリプトが NG で止まる | 秘密情報らしき値、または提出先の未追跡ファイル | 表示された行を直す。テスト用のダミーなら submit-allow: を付ける |

**後片付け**：Demo Day（11/27）と GDG DevFest Tokyo（11/29）の後も動かさないなら、gcloud projects delete "$PROJECT_ID" でプロジェクトごと削除します。サービスアカウントと鍵も一緒に消え、30日後に完全に削除されます。

## 認証情報の引き継ぎ

チーム167の認証情報を、だれが持ち、どう渡し、どう止めるかをまとめます。値はこの手順書にも一切書きません。雛形の docs/credentials.md に同じ内容の写しがあります。

### 原則

- **実装担当が PR を出すだけなら、秘密情報は1つも要らない。** 手元の開発はエミュレータと Gemini のモックで動き、GitHub Actions から GCP へは鍵を使わない WIF で認証する。GitHub の Secrets も使わない。
- **秘密情報は渡さない。必要な人が自分で発行する。** 鍵やトークンを、チャット・メール・Issue・PR・ログ・スクリーンショット・リポジトリに貼らない。開発用リポジトリも提出用リポジトリも公開されている。
- **止め方を先に決めておく。** 人が抜けたとき、ハッカソンが終わったとき、漏れたときに、だれが何を消すかを下の表に決めてある。

### 一覧

| 認証情報 | 秘密か | 持つ人・置き場所 | 実装担当に要るか | 渡し方 | 止め方 |
|---|---|---|---|---|---|
| クレジットコード | 秘密 | 代表者だけ。引き換えた後は不要 | 要らない | 渡さない（運営の規約でチーム外への共有と公開を禁止） | — |
| 請求先アカウント | 権限 | 代表者（請求先の管理者） | 要らない | 予算の通知を受けたい人だけ、代表者が請求先の閲覧者に加える | 代表者が請求先の権限から外す |
| GCP プロジェクトの編集者 | 権限 | 各自の Google アカウント | 任意（本番のログや Firestore を見るとき） | オーナーが IAM で付ける（手順9）。本人は gcloud auth login | オーナーが IAM から外す |
| 手元の ADC | 秘密（各自の PC の中） | 各自の PC | 任意（手元から本物の Gemini を試すとき。GEMINI_MOCK=0 bash scripts/dev.sh serve） | 本人が gcloud auth application-default login | 本人が gcloud auth application-default revoke |
| 開発用リポジトリの書き込み権限 | 権限 | 各自の GitHub アカウント | 要る | オーナーが Collaborator に招待し、本人が受け入れる | オーナーが Collaborator から外す |
| 提出用リポジトリの書き込み権限 | 権限 | 各自の GitHub アカウント | 締切前に反映する人だけ | 運営から届く招待を7日以内に受け入れる | 運営に連絡する |
| GitHub Actions から GCP への認証 | 秘密なし（WIF） | GitHub の Actions の Variables（PROJECT_ID・REGION・VERTEX_LOCATION・GEMINI_MODEL・WIF_PROVIDER・DEPLOYER_SA） | 要らない | オーナーが infra/setup-deployer.sh の表示どおりに登録する | オーナーが WIF のプロバイダを無効にするか、github-deployer を消す |
| AI 用サービスアカウントの鍵（GCP_SA_KEY） | 秘密 | クラウドの Claude Code・Codex の環境変数だけ | 任意（クラウドの AI ツールから GCP を操作するとき） | 使う人が自分で作り、自分の環境に登録する（下の手順） | 作った人かオーナーが鍵を消す |
| Firebase の Web 設定（apiKey など） | 秘密ではない | App Hosting が画面に自動で渡す | 要らない | — | — |
| Gemini | 鍵なし | Cloud Run の api-runtime が Vertex AI を権限で呼ぶ | 要らない | — | — |
| エミュレータのテストユーザー | ダミー | firebase/seed.mjs（submit-allow: 付き） | 要らない | — | — |
| gh・Claude Code・Codex のアカウント | 各自 | 各自の契約とログイン | 要る（PR を出すため） | 本人が gh auth login。クラウドの AI ツールは各自の GitHub 連携 | 本人がログアウトする |

### 実装担当が加わるとき

1. オーナーが開発用リポジトリに Collaborator（Write）として招待し、本人が受け入れる。
1. 本人が clone して bash scripts/dev.sh setup と bash scripts/dev.sh serve を実行する（雛形の CONTRIBUTING.md の「起動する」）。ここまでで PR を出せる（gh auth login のあと bash scripts/dev.sh pr）。
1. 任意：本番のログを見たい、手元から本物の Gemini を試したい場合は、オーナーに Google アカウントを伝えて編集者を付けてもらい、gcloud auth login と gcloud auth application-default login を実行する。
1. 任意：クラウドの Claude Code や Codex から GCP を操作したい場合は、下の「AI 用の鍵を作る」を行う。

### AI 用の鍵を作る

鍵は人ごとに作り、ほかの人と共有しない。

```bash
source infra/env.sh
bash infra/setup-ai-access.sh               # ~/ai-dev-key.json ができる（権限が足りなければオーナーに頼む）
cat ~/ai-dev-key.json                       # 中身を、自分のクラウド環境の環境変数 GCP_SA_KEY に貼る
rm ~/ai-dev-key.json                        # 登録したらすぐ消す
gcloud iam service-accounts keys list --iam-account="ai-dev@${PROJECT_ID}.iam.gserviceaccount.com"   # 作った鍵の ID を確かめる
```

鍵の中身ではなく ID だけを、下の「AI 用の鍵の記録」に「だれの鍵か」と一緒に書いておく。止めるときに、どれを消せばよいかが分かる。

- Claude Code：セッションのタイトルバーの環境メニュー →「Edit」で、環境変数 GCP_SA_KEY に貼る。新しいセッションで、.claude/settings.json のフックが自動で gcloud にログインする。
- Codex：環境の設定で環境変数 GCP_SA_KEY を登録し、タスクの最初に bash scripts/claude-gcp-login.sh を実行する（雛形の docs/codex-handoff.md の6章）。

**AI 用の鍵の記録**（鍵の ID だけを書く。中身は書かない）

| 鍵の ID | だれの鍵か | 登録した環境 | 作った日 |
|---|---|---|---|
| （まだない） | — | — | — |

### 抜けるとき・終わったとき

| いつ | だれが | すること |
|---|---|---|
| メンバーが抜けるとき | オーナー | 開発用リポジトリの Collaborator から外す。IAM から外す。その人の AI 用の鍵を gcloud iam service-accounts keys delete <鍵の ID> --iam-account=ai-dev@${PROJECT_ID}.iam.gserviceaccount.com で消す |
| 11/10 の提出のあと | オーナー | AI 用の鍵を、デモに使う分を残してすべて消す |
| 11/29 の GDG DevFest Tokyo のあと | オーナー | 動かし続けないなら gcloud projects delete "$PROJECT_ID"。サービスアカウント・鍵・WIF も一緒に消える |

### 漏れたとき

1. すぐに、その鍵を消す（上の keys delete）。トークンなら発行元で無効にする。
1. 必要なら作り直し、使っていた環境に登録し直す。
1. 公開リポジトリに push してしまった場合は、履歴から消すだけでは足りない（すでに誰でも見られた）。鍵を消したことをチームに知らせる。提出用リポジトリに入った場合は、運営にも連絡する。
1. クレジットコードが漏れた場合は、すぐに運営に連絡する。

## 実装担当の開発 UX（到達条件）

最終目標は、実装担当の2人が PR を出すだけで、一切不自由なく開発できることです。次の7つを満たしたときに、構築が終わったとみなします。仕組みはすべて雛形に入っています。GitHub と GCP の上での確認は、構築のときに行います（雛形の docs/codex-handoff.md の3章）。

| 目標 | 仕組み | 手元で確かめたこと | 構築後に確かめること |
|---|---|---|---|
| 1. 招待を受けて clone すれば、秘密情報なしに数コマンドで動く | bash scripts/dev.sh setup と serve（エミュレータとモック）。Windows は WSL、手元に入れたくない人は .devcontainer | Linux で起動と check を確認。.devcontainer は形式だけ確認 | Codespaces（VS Code から）で起動と check |
| 2. PR を出せば自動で検査し、文書だけの PR は待たない | ci.yml の changes と test。test は bash scripts/dev.sh check を呼ぶだけ | check の全件、変更判定の回帰テスト9件 | 文書だけの PR で test が省かれ、コードの PR で通る |
| 3. Yuto Matsui の本番反映の承諾後、CI の通過から本番反映まで自動で進む | bash scripts/dev.sh pr が検査・push・PR の作成・auto-merge を1回で行う。deploy.yml が Rules → API → 画面の順に反映する | dev.sh pr の回帰テスト9件（偽の gh と手元のリポジトリ） | Yuto Matsui が本番反映を承諾したコードの PR が、追加の操作なしにマージされ、deploy が成功する |
| 4. マージの前に本物の Gemini で試せる | GEMINI_MOCK=0 bash scripts/dev.sh serve。API の VERTEX_PROJECT で、Firestore（エミュレータ）と Vertex AI のプロジェクトを分け、VERTEX_LOCATION=global で Gemini に接続する | モデルが未定のとき、ADC がないときに、理由を表示して止まる | 手元のエミュレータで、本物の Gemini の提案が司会者の画面に出る |
| 5. 本番が壊れたら1回の操作で戻せる | deploy の手動実行。過去にデプロイが成功したコミットだけに戻せる | — | 直前のコミットに戻せ、成功していないコミットの指定は止まる |
| 6. 鍵を誤って push しようとしても止まる | infra/setup-github.sh が secret scanning と push protection を有効にする。提出のときは submit.sh が検査する | submit.sh の回帰テスト16件 | push protection が有効になっている |
| 7. 2人と AI エージェントが同時に PR を出しても食い違わない | Rules・API・画面を同じコミットから順に反映し、デプロイは同時に1つだけ。main の CI が通らなければ反映しない。Rules・ワークフロー・構築の変更はレビューを通す | — | 2つの PR を続けてマージし、2回とも正しく反映される |

**うまくいかないとき**

| 症状 | 原因 | 対処 |
|---|---|---|
| dev.sh pr が「main では実行できません」で止まる | main の上で作業している | git switch -c <種類>/<内容> でブランチを作ってから実行する |
| dev.sh pr の auto-merge でエラーになる | main のルール（test の成功が必須）が設定されていない。auto-merge にはこのルールが要る | オーナーが bash infra/setup-github.sh を実行する |
| GEMINI_MOCK=0 で起動すると ADC のエラーで止まる | gcloud auth application-default login をしていない、または編集者の権限がない | 「認証情報の引き継ぎ」の「実装担当が加わるとき」の3を行う |
| Codespaces で画面からログインできない | ブラウザ版の Codespaces で開いたので、画面がエミュレータに 127.0.0.1 でつなげない | VS Code から Codespaces を開く |
