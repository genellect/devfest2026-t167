# Codex への引き継ぎ：開発インフラとクラウドの構築

DevFest Hackathon 2026 チーム167 の開発用リポジトリ（Public）で、開発インフラと Google Cloud・Firebase を構築する。作業の進め方は [AGENTS.md](../AGENTS.md) に従う。

## 最終目標

**実装担当の2人が、PR を出すだけで、一切不自由なく開発できること。** 具体的には、次がすべて成り立つ状態をこの依頼の完了とする。

1. 招待を受けて clone すれば、秘密情報なしに、数コマンドで手元（または AI ツールのクラウド環境）で画面と API が動く。
2. PR を出せば、CI が自動で検査する。文書だけの PR は待たされない。
3. Yuto Matsui が本番反映を承諾したあとは、CI が通れば追加の操作なしにマージされ、本番に反映される。結果（成功・失敗、反映したコミット）がすぐ分かる。
4. マージの前に、本物の Gemini での動きを手元で確かめられる。
5. 本番が壊れたら、1つの操作で直前の正常な状態に戻せる。
6. 公開リポジトリに鍵を誤って push しようとしても止まる。
7. 2人と AI エージェントが同時に PR を出しても、Rules・API・画面が食い違わない。

## 参照する文書

| 文書 | 場所 | 用途 |
|---|---|---|
| インフラ構築・開発手順書 v4（正本） | チームドキュメントの「インフラ構築手順書」タブ：https://docs.google.com/document/d/1zHg74msQ1xBgsautfcQNsv-dDlQcO4WqzbV0ZDNnv5A/edit?tab=t.t1975sujc4nn | チームが読む正本。共有されたメンバーだけが開ける |
| 同じ手順書の写し | [docs/infra-manual.md](infra-manual.md) | 正本を読めなかったときの予備（2026-11-05 時点の正本と同じ内容）。メンバーのメールアドレスだけを伏せた |
| 認証情報の引き継ぎ | [docs/credentials.md](credentials.md) | だれが何を持ち、どう渡し、どう止めるか |
| 開発のルール | [CONTRIBUTING.md](../CONTRIBUTING.md)、[AGENTS.md](../AGENTS.md) | ブランチ、PR、CI、マージ、報告のルール |

### 段階1の構築設定と実環境の記録（2026-11-05）

依頼者が指定した新規 Public リポジトリは [genellect/devfest2026-t167](https://github.com/genellect/devfest2026-t167)。依頼者は同日、Gemini だけを global に変更し、Cloud Run・Firestore は東京に維持する方針を承認した。

- `DEV_REPO=genellect/devfest2026-t167`：今回新規作成した Public リポジトリ。提出先は変更しない。
- `PROJECT_ID=devfest2026-t167`：作成済み。プロジェクト番号は `1086529845261`、状態は `ACTIVE`。新規リポジトリ名と一致している。
- `REGION=asia-northeast1`、`APPHOSTING_REGION=asia-east1`：Cloud Run・Firestore と画面のリージョンは維持する。
- `VERTEX_LOCATION=global`、`GEMINI_MODEL=gemini-3.5-flash`：Google 公式の[モデル情報](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-5-flash)で global の Standard PayGo、構造化出力、temperature の指定への対応を確認した（2026-11-05）。[ライフサイクル](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/model-versions)上の廃止予定は2027-05-19以降。
- `setup-deployer.sh` が示す GitHub Variables は `PROJECT_ID`・`REGION`・`VERTEX_LOCATION`・`GEMINI_MODEL`・`WIF_PROVIDER`・`DEPLOYER_SA` の6つ。ローカルの `GEMINI_MOCK=0` も同じ接続先を使う。

正本の東京指定に対し、公式資料はモデルの東京の利用可能性と Standard PayGo の対応先を分けており、東京には Single Zone Provisioned Throughput のみという注記があるため、依頼者の承認を受けて接続先を分離した。Provisioned Throughput は追加しない。実プロジェクトからのモデル利用・割り当て・実呼び出しは構築後に検証し、設定とモックの検査だけで本番の動作確認済みとはしない。

Google Docs 正本はまだ変更していないため、`docs/infra-manual.md` は正本に対応する状態を維持する。正本への反映事項（リポジトリ名、Gemini の接続先、Variables の6つへの変更）は PR の説明に一覧化する。正本を変更する段階で、依頼者の指示どおり写しも反映する。

### メインエンジニア間の協働

Codex と Claude は同格のメインエンジニアとして、目的に向けて独立に設計・実装し、互いの PR をレビューする。Claude は自身が提案した起動設定・デプロイ前検証・クラウドログイン・開発環境・関連文書の改善を自律的に進める。Codex は Firebase 以降の実環境構築と構築記録を進める。設計、作業ブランチ、PR の切り方は各担当が判断し、担当が重なる点は当事者同士で調整する。

## 1. 依頼の範囲

**やること**

- 手順書の手順2〜9のうち、「作業の順番」に Codex の担当と書いたものを実行し、結果を確かめる。
- 2章で「未確認」とした点を、実際の GitHub と GCP の上で確かめる。動かなければ直す。
- 構築スクリプト（`infra/`）、ワークフロー（`.github/workflows/`）、開発の入口（`scripts/dev.sh`）を、実際の環境で動くように直す。
- 直した内容を、手順書の写し・README・CONTRIBUTING・AGENTS.md・credentials.md に同じ PR で反映する。

**やらないこと**

- フロントエンド（`web/`）とサーバーサイド（`api/`）の本格的な実装。雛形の最小の実装のままにし、インフラの確認に必要な最小の修正だけ行う。
- 既存のリポジトリへの反映。提出用リポジトリ（Devfest-Hackathon-2026/df-2026-t167）には何も push しない。提出は締切前に人が別に判断する。
- 依頼者の指示がない `main` へのマージ、本番の GCP の削除や作り直し、有料の設定の追加。
- 速度優先のため、必要以上のセキュリティの仕組みを足すこと（AGENTS.md の「常に守ること」は守る）。

## 2. 最終目標に対する現状（2026-11-05、段階5完了）

| 目標 | 現状 | 判定 |
|---|---|---|
| 1. 秘密情報なしに数コマンドで動く | `bash scripts/dev.sh setup` と `serve` で、エミュレータとモックで動く。GCP の認証情報は要らない。手元に入れたくない人と Windows の人向けに `.devcontainer`（Node.js 22・Java 21・gh・Chromium）を加えた | Linux で達成。`.devcontainer` は JSON の形だけ確かめ、起動は未確認。macOS は未確認 |
| 1. AI ツールのクラウド環境 | Claude Code は `.claude/cloud-setup.sh`、Codex は `.codex/setup.sh` | Claude Code は同じ手順で確かめた。Codex Desktop から WSL Ubuntu 26.04.1・Node.js 22.22.1・Java 21 で `.codex/setup.sh` と `scripts/dev.sh check` を実行し、ともに終了コード0（2026-11-05）。Codex クラウド環境への登録・実行は未確認 |
| 2. PR で自動検査・文書だけなら待たない | 文書だけの PR #1 で changes 成功・test 省略、設定変更の PR #2 の `88c79fd` で全検査70件が成功。Claude も同コミットで独立に全検査を再実行し成功 | GitHub と手元で確認済み。実行時間の README への記録は段階9で行う |
| 2. 手元の検査が CI と一致 | CI は `bash scripts/dev.sh check` を呼ぶだけ | 達成（手元で全件通った） |
| 3. CI が通れば追加の操作なしにマージ | `bash scripts/dev.sh pr` が、手元の検査・push・PR の作成・auto-merge の設定を1回で行う。Rules・ワークフロー・構築スクリプトを変える PR には auto-merge を付けず、レビューを求める。回帰テスト9件（偽の gh と手元の bare リポジトリ）が通った | 手順と仕組みは完成。GitHub 上の auto-merge は未確認（main のルールで test が必須になっていないと auto-merge は使えない） |
| 3. 本番に自動で反映し、結果が分かる | `deploy.yml` が CI 通過後に Rules → API → 画面の順に反映し、サマリーに記録する | 未検証。失敗の通知は GitHub の既定の通知だけ |
| 4. マージ前に本物の Gemini を試せる | Firestore・Auth はエミュレータ、Vertex AI は本番プロジェクトに分離する。Gemini の接続先は依頼者承認済みの global。空・未設定時の起動処理と gcloud がない場合の案内は Claude のレビューで改善点として確認した | 接続先の受け渡しとモックの検査は確認済み。実モデルの呼び出しと起動時の改善は未完了 |
| 5. 1つの操作で戻せる | `deploy.yml` の手動実行で、過去に成功したコミットだけに戻せる | 未検証 |
| 6. 鍵の誤 push が止まる | `infra/setup-github.sh` が secret scanning と push protection を有効にする（公開リポジトリでは無料） | 未検証 |
| 7. 同時の PR で食い違わない | Rules・API・画面を同じコミットから順に反映し、デプロイは同時に1つだけ。main の CI が通らなければ反映しない | 設計済み・未検証 |
| 前提：GCP・Firebase・リポジトリ | Public リポジトリ `genellect/devfest2026-t167` と GCP プロジェクト `devfest2026-t167` を作成済み。請求先リンク・予算2本・東京の Firestore・Artifact Registry・api-runtime の作成を確認し、`setup-project.sh` は2回成功。Firebase 追加と Web アプリ `t167-web` の ACTIVE を確認し、コンソールで Google・匿名ログインの両方が有効であることを確認した | 段階0〜5を確認済み。段階6以降は未完了 |

**段階0〜5は確認済みで、最終目標1〜7の完了ではない。** App Hosting 以降の構築、実モデル・本番 URL・デプロイ・ロールバック・Codespaces の検証と、独立レビューで見つかった改善を進める。確認済みの検査と、まだ動かしていない実環境の流れを分けて扱う。

## 3. 作業の順番と完了条件

番号は手順書の手順に対応する。各段階の完了条件を満たしてから次に進む。

| 段階 | 内容 | 担当 | 完了条件 |
|---|---|---|---|
| 0 | Codex の環境に `bash .codex/setup.sh` を登録し、`bash scripts/dev.sh check` を実行する | Codex | すべて通る |
| 1 | `infra/env.sh` の値を決める。DEV_REPO はオーナーが作ったリポジトリ名、PROJECT_ID は使用済みなら末尾に数字を足す、GEMINI_MODEL は Model Garden で global の Standard PayGo に対応するモデル | Codex（モデルは確かめた根拠を PR に書く） | PR で変更し、決めた理由が書いてある |
| 2 | 手順1：クレジットと請求先 | 人 | 請求先アカウントの ID とクレジット額が Codex に伝わっている |
| 3 | 手順2：プロジェクトの作成、請求先とのリンク、予算2本 | Codex（リンクに請求先の権限が要るなら人） | `gcloud billing budgets list` で2本ある |
| 4 | 手順3：`bash infra/setup-project.sh` | Codex | 2回実行しても成功する |
| 5 | 手順4：Firebase の追加と Web アプリ、Authentication | Codex と人 | Google と匿名のログインが有効 |
| 6 | 手順6：App Hosting のバックエンド（ID は web、asia-east1、ルートは web）と `web/apphosting.yaml` の API_ORIGIN | Codex | `firebase apphosting:backends:list` に web があり、API_ORIGIN が本物の URL |
| 7 | 手順8：`bash infra/setup-deployer.sh`、GitHub の Variables 6つ、`bash infra/setup-github.sh` | Codex と人（setup-github.sh はオーナー） | Variables が登録され、main のルールと push protection が有効 |
| 8 | **目標3を確かめる。** `bash scripts/dev.sh pr` でコードの PR を出す | Codex | CI が通った PR が、人の操作なしに squash merge される。Rules を変える PR には auto-merge が付かない |
| 9 | CI を GitHub で確かめる。文書だけの PR とコードの PR を1つずつ出す | Codex | 文書だけの PR で test が省かれ、コードの PR で test が通る。所要時間を README に書く |
| 10 | 初回のデプロイ。オーナーの指示で main にマージする | Codex と人 | deploy が成功し、サマリーにコミットと API のリビジョンがある |
| 11 | 本番の確認 | Codex と人 | 本番の URL が開き、`/api/health` が `{"ok":true,"gemini":"gemini"}` を返す（Cloud Run は `/healthz` を予約していてコンテナに届かない）。司会者が Google ログインで部屋を作り、参加者が参加コードで匿名で参加できる |
| 12 | ロールバックの確認。Run workflow で直前の成功したコミットを指定する | Codex（オーナーの指示を受けて） | 成功し、成功していないコミットの指定は止まる |
| 13 | **目標4を確かめる。** 編集者の権限で ADC を作り、`GEMINI_MOCK=0 bash scripts/dev.sh serve` で分析を実行する | Codex | 手元のエミュレータで、本物の Gemini の提案が司会者の画面に出る |
| 13a | `.devcontainer` を Codespaces（VS Code から）で開き、`serve` と `check` を実行する | Codex か人 | 画面から参加コード DEMO01 で参加でき、check が通る |
| 14 | 手順9：メンバーの権限と AI 用の鍵（[credentials.md](credentials.md)） | 人と Codex | メンバーが gcloud でプロジェクトを見られる。鍵の ID とだれの鍵かが正本の手順書に書いてある |
| 15 | **最終確認。** 実装担当役として、新しい clone から `setup` → 小さな変更 → `pr` の順に実行する | Codex | 最終目標の1〜7をすべて満たし、2章の表を「達成」に更新した PR がある |

手順10の通しテスト（端末4台）と手順11の提出は、この依頼の範囲外。

## 4. 前提と制約

- **リポジトリは Public。** コード、PR、Issue、Actions のログは誰でも見られる。鍵・トークン・クレジットコードは、コミット・ログ・PR に書かない。鍵は環境変数だけで渡す。
- **公開リポジトリでの CI。** 外部からの PR でも CI が動く。`ci.yml` は GCP を使わないので、そのままでよい。`deploy.yml` は `main` への push と手動実行だけで動かし、`pull_request_target` は使わない。
- **Actions と main のルール。** 開発用リポジトリでは Actions が使え、公開リポジトリなので Free プランでも main のルールを設定できる（提出用リポジトリでは Actions が使えない）。
- **リージョン。** App Hosting は asia-east1（東京は非対応）。Cloud Run・Firestore は asia-northeast1。Vertex AI の Gemini 接続先は依頼者の承認により global。
- **締切。** 提出は 2026-11-10 19:00 で、過ぎると提出用リポジトリは読み取り専用になる。17:00 までに一度提出用に反映できる状態にする。
- **費用。** 運営のクレジットで賄う。予算アラートを2本設定する（手順2）。

## 5. 人がやること

Codex にはできない、またはさせない作業。必要になったら作業を止め、依頼者に頼む。

| 作業 | 担当 | 手順書 |
|---|---|---|
| 開発用リポジトリ（Public）の作成と、実装担当2人の Collaborator への招待 | オーナー | 手順5 |
| クレジットの引き換えと請求先アカウントの作成。クレジットコードは Codex に渡さない | チームの代表者 | 手順1 |
| 請求先アカウントの ID とクレジット額を Codex に伝える | 代表者 | 手順1 |
| Firebase コンソールで、Authentication の Google と匿名を有効にする | メンバー | 手順4 |
| リポジトリの管理者として `gh` でログインし、`bash infra/setup-github.sh` を実行する | オーナー | 手順8 |
| Codex の環境に GCP の認証情報を渡す（6章） | オーナー | 手順9 |
| メンバーのメールアドレスを伝え、編集者の権限を付ける | オーナー | 手順9 |
| `main` へのマージの指示 | オーナー | 開発のルール |

## 6. Codex から GCP を操作する

認証情報の全体は [credentials.md](credentials.md) にある。

- **手元の PC の Codex CLI**：そのメンバーが `gcloud auth login` と `gcloud auth application-default login` をしておけば、Codex はその権限で gcloud と Admin SDK を使える。
- **Codex のクラウド環境**：
  1. オーナーが [credentials.md の「AI 用の鍵を作る」](credentials.md#ai-用の鍵を作る)のとおりに、Codex 用の鍵を作る。
  2. 鍵の中身を Codex の環境の設定に、環境変数 `GCP_SA_KEY` として登録する。
  3. タスクの最初に `bash scripts/claude-gcp-login.sh` を実行する（名前は Claude 向けだが、中身は `GCP_SA_KEY` で gcloud にログインするだけ）。続けて `export GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/gcloud/t167-key.json"` を実行する。

  環境変数をセットアップスクリプトの中で読めるか、エージェントの実行中にも残るかは、Codex の環境の設定画面で確かめる。

- **セットアップスクリプト**：Codex の環境に `bash .codex/setup.sh` を登録する。依存、E2E 用の Chromium、Firestore エミュレータの本体を、インターネットに接続できる間に取得する。
- **接続先**：環境のネットワーク設定で、次の接続先を許可する。
  - `registry.npmjs.org`、`github.com`
  - `*.googleapis.com`（gcloud・Firebase・Vertex AI。エミュレータの本体も storage.googleapis.com から取得する）
  - Playwright のブラウザの配布元、`firebase.google.com`

## 7. 報告

- PR の説明に、AGENTS.md の形で書く。「実装した」「CI が通った」「本番に反映した」「本番の URL で確かめた」を分ける。
- 作ったリソース（プロジェクト ID、App Hosting の URL、Cloud Run の URL、サービスアカウント名）を書く。鍵の中身や請求先の詳細は書かない。
- 人に頼む作業が残っていれば、「5. 人がやること」の表の行を示して書く。
- 手順書の正本（Google Docs）は、作業の前と PR の前に毎回読む。正本の更新は依頼者の指示がない限り人が行うので、反映が要る変更は PR の説明に一覧で書く。
