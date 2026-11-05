# T167 AI協調型グループディスカッション支援

**「全員賛成」の中身のずれを、議論が終わる前に見つける。**

<!-- 提出前に記入：作品の URL とデモ動画を、次の行の先頭に [作品](URL) · [デモ動画](URL) · として足す。構成図の画像は docs/architecture.png。この README には確かめた状態だけを書く -->
[アーキテクチャ](#アーキテクチャ) · [Gemini の役割](#gemini-の役割) · [技術の選定理由](#技術の選定理由と制約) · [テスト](#テスト) · [開発に参加する](#開発に参加する) · [チーム](#チーム)

議論の前に全員の意見を非公開で集め、Gemini が「まだ議論されていない論点」と「合意の中身のずれ」を見つけて司会者に知らせる Web アプリ。司会者は AI の提案を承認してから全員に示すので、議論の主導権は人に残る。DevFest Hackathon 2026 の教育カテゴリの作品で、Google Cloud の Gemini（Vertex AI）・Cloud Firestore・Cloud Run・Firebase App Hosting・Firebase Authentication で動かす。

## 課題と3つの機能

大学のゼミやグループ学習では、発言が一部の人に偏り、少数意見が埋もれ、合意したつもりでも中身がずれていることがある。既存の会議 AI は発言の記録と要約が中心で、**発言されなかった意見**と**合意のずれ**は拾えない。

| 機能 | すること |
|---|---|
| 事前意見収集 | 議論の前に、全員の意見を非公開で集める。司会者も他の参加者も本文を読めない |
| 未検討論点の検出 | 事前意見と実際の議論を Gemini で照合し、まだ取り上げられていない論点を司会者に提案する。承認したものだけ全員に表示する |
| 合意の実態検証 | 結論が出たときに各自が合意内容を一文で書き、Gemini がずれを可視化する |

部屋は `collecting`（事前意見）→ `discussing`（議論）→ `consensus`（合意の確認）→ `closed` の順に、司会者が1つずつ進める。参加者はスマホで6文字の参加コードを入れ、匿名ログインで参加する。司会者は Google でログインする。

## アーキテクチャ

<!-- 提出前に構成図を docs/architecture.png に置き、次の行の先頭と末尾のコメントを外す -->
<!-- ![構成図](docs/architecture.png) -->

画面・API・データを Google Cloud のマネージドサービスに分け、ブラウザからは同じオリジンの `/api` と Firestore の購読だけを使う構成。サーバーは使わない時間に0台まで縮む。

```
議論の流れ
  web/        Next.js（Firebase App Hosting · asia-east1）。/api を同じオリジンで受けて Cloud Run へ転送
  → api/      Express + TypeScript（Cloud Run · asia-northeast1）。認可、フェーズ、分析の排他、指標の計算
    → Gemini  gemini-3.5-flash（Vertex AI · global）。論点の抽出と照合、合意文のまとめ（構造化出力）
    → Firestore（asia-northeast1）。部屋ごとのサブコレクション

リアルタイム更新
  ブラウザ → Firestore を直接購読（firebase/firestore.rules で読める範囲を制限）

デプロイ
  PR → CI（bash scripts/dev.sh check）→ main に squash merge
  → Variables の検査 → 鍵なしの認証（Workload Identity 連携）
  → Rules → API（Cloud Run）→ 画面（App Hosting）を同じコミットから順に反映
```

| 部分 | 実行場所 | Gemini に送るもの |
|---|---|---|
| 画面 | Firebase App Hosting（asia-east1。東京は非対応） | — |
| API | Cloud Run（asia-northeast1）。使わない時間は0台 | 部屋の事前意見・発言・合意文の本文（持ち主の ID は送らない） |
| Gemini | Vertex AI の global エンドポイント（[処理場所](#送るデータと処理場所)） | — |
| データ | Cloud Firestore（asia-northeast1） | — |
| ログイン | Firebase Authentication（参加者は匿名、司会者は Google） | — |

### 設計の要点

- 非公開の事前意見は、本人と API だけが読める。Rules と API の両方で確かめる。API は Admin SDK を使うので Rules を通らないため
- 司会者と他の参加者に届くのは、API が持ち主を伏せて要約した論点だけにする。少数意見を出しやすくするため
- AI の提案は司会者が承認してから全員に表示する。Gemini の出力は毎回少し変わり、誤りもあるため
- Gemini には本文だけを送り、保存と API は東京に置く。Gemini の接続先は global で、処理場所が日本に限られないため
- ブラウザは常に同じオリジンの `/api` を呼ぶ。CORS の設定と、画面と API の URL の食い違いをなくすため
- Rules・API・画面を同じコミットから順に反映し、戻すときも3つをそろえて戻す。新しい画面と古い API が食い違わないため
- GitHub から GCP へは鍵を使わずに認証し、リポジトリに秘密情報を置かない。開発用リポジトリも提出用リポジトリも公開されているため

### API と認可

| エンドポイント | ログイン | 部屋の所属 | 司会者 | フェーズ |
|---|---|---|---|---|
| `GET /healthz` | 不要 | — | — | — |
| `POST /rooms` | 必要（匿名は不可） | —（作成者が司会者になる） | — | — |
| `POST /rooms/join` | 必要（匿名で可） | —（参加コードで部屋を特定） | — | `closed` 以外 |
| `POST /rooms/{部屋}/phase` | 必要 | 必要 | 必要 | 1つずつ順に進める |
| `POST /rooms/{部屋}/analyze` | 必要 | 必要 | 必要 | `discussing` |
| `POST /rooms/{部屋}/insights/{提案}/approve` | 必要 | 必要 | 必要 | — |
| `POST /rooms/{部屋}/consensus/analyze` | 必要 | 必要 | 必要 | `consensus` |

エラーは `401`（未ログイン）・`403`（所属・役割が違う）・`404`（参加コードや部屋がない）・`409`（フェーズ違い・分析中・処理済み）・`429`（30秒以内の再分析）・`503`（Gemini の失敗）で返し、本文は `{ "error": { "code", "message" } }` の形にそろえる。

### 結果の整合性

| 仕組み | 防ぐこと |
|---|---|
| 分析の開始時に、部屋のドキュメントへトランザクションで jobId を書く | Cloud Run が複数台になったときの分析の二重実行 |
| 結果の保存時に jobId を照合し、一致しなければ捨てる | 遅れて返った古い分析が新しい結果を上書きすること |
| 1部屋30秒に1回まで（`429` と残り秒数を返す） | Gemini の費用の急増と、画面の連打 |
| 書き込みは決められたフェーズで本人名義だけ（Rules） | 他人へのなりすましと、締め切ったフェーズへの書き込み |
| Gemini が失敗しても発言と意見は Firestore に直接書く | AI の障害で議論が止まること |
| 接続先・モデル・Variables が空なら、起動とデプロイの前に止まる | 設定漏れのまま本番に出て、分析だけが失敗し続けること |

## Gemini の役割

Gemini が担うのは、文章の意味を比べる2つの判定だけ。数える・割合を出す・誰に見せるかを決めるのは API と Rules。未検討論点の提案は司会者の承認を経てから全員に届く。合意の分析結果は承認を挟まず、部屋のメンバー全員が結果として読める。

```
未検討論点の検出（議論中に司会者が実行）
  事前意見の本文 + 議論の発言
  → Gemini：論点を最大10個取り出し、それぞれ議論で取り上げられたかを判定
  → API で型・件数・長さを検証 → 未検討の論点を「承認待ち」で保存
  → 司会者が承認 → 参加者の画面にも表示

合意の実態検証（合意フェーズで司会者が実行）
  各自の合意の一文 + 承認済みの提案 + 承認後の発言
  → Gemini：意味が同じ一文をまとめ、承認後に取り上げられた提案を判定
  → API で検証し、まとまりと4つの指標を保存（承認は挟まず、部屋のメンバー全員が読める）
```

- 応答は構造化出力（`responseSchema`）で JSON として受け、API が zod で型・件数・長さを検証する。形が崩れた応答は保存せず `503` にする
- `temperature` は 0。同じ議論から毎回違う提案が出るのを抑えるため
- 1回の呼び出しは20秒で打ち切る。分析中の再実行は `409`、30秒以内の再実行は `429` と残り秒数を返す
- 保存する結果には、本物の Gemini かモックかを記録する。デモデータと実測を取り違えないため

### 送るデータと処理場所

| 送るもの | 送らないもの |
|---|---|
| 事前意見・発言・合意の一文の本文、承認済みの提案の要約 | 参加者の ID・名前・メールアドレス、参加コード |

Gemini は Vertex AI の **global エンドポイント**で呼ぶ。`gemini-3.5-flash` の通常の従量課金（Standard PayGo）は global と米国・欧州のマルチリージョンだけで提供され、東京（asia-northeast1）は専用の容量契約（Provisioned Throughput）に限られるため（[モデル情報](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-5-flash)、2026-11-05 に確認）。

global では、リクエストがどのリージョンで処理されるかが決まらない（[データの扱い](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/data-governance)）。そのため Gemini に送るのは判定に要る本文だけにし、意見・発言・結果の保存（Firestore）と API は東京に置く。Google は、利用者の許可なくこのデータをモデルの学習や調整に使わない。

応答を速くするため、Vertex AI は既定でプロンプトをキャッシュする。メモリ上と、暗号化された保存領域（durable。このプロジェクトでも既定のまま有効）の2段で、どちらも書き込みから24時間以内に消え、学習には使われない。global ではキャッシュも、どのリージョンに置かれるかが決まらない。また Google は、不正利用の検出のためにプロンプトを記録することがある（[データの保持](https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/zero-data-retention#implicit_data_caching)、2026-11-05 に確認）。

## 4つの指標

指標は API が保存データから計算する（[`api/src/metrics.ts`](api/src/metrics.ts)）。Gemini の判定を使う値には「Gemini による推定」と表示し、モックで動かしたときは「デモデータ」と表示して、実測の改善効果とは区別する。

| 指標 | 計算方法 | データがないとき |
|---|---|---|
| 意見の反映率 | 事前意見の論点のうち、議論で取り上げられた割合 | 事前意見が0件なら「データなし」 |
| 認識一致度 | 合意の一文を意味でまとめたとき、最も大きなまとまりに入った人の割合 | 回答が2人未満なら「データなし」 |
| 参加の公平性 | 1 −（参加者ごとの発言数のジニ係数）。全員同じ数なら 100% | 参加者2人未満、または発言0件なら「データなし」 |
| 介入の有効率 | 承認した提案のうち、承認後の発言で取り上げられた割合 | 承認した提案が0件なら「データなし」 |

## 技術の選定理由と制約

| 技術 | 選んだ理由 | 欠点・制約 | 対策 |
|---|---|---|---|
| Gemini（Vertex AI） | 日本語の議論から論点を取り出し、意味の近さで文をまとめられる。構造化出力で JSON を直接受け取れる。Cloud Run のサービスアカウントの権限で呼べ、API キーが要らない | 応答に数秒かかる。出力が毎回少し変わる。費用がかかる。東京では通常の従量課金がない | 提案は司会者の承認制。分析は1部屋30秒に1回まで。temperature 0。接続先は global にし、送るのは本文だけ |
| Cloud Firestore | 参加者のスマホに変化を即時に届けられる。Rules で読める範囲をデータベース側で強制できる | 結合ができない。Rules 内の get も読み取りとして課金される | 部屋単位のサブコレクションにする。Rules はエミュレータで自動テストする |
| Cloud Run | Gemini の呼び出しや集計など、クライアントに置けない処理を動かせる。使わない時間は0台 | コールドスタートで最初の応答が遅い | デモの時間帯だけ最小インスタンスを1にする |
| Firebase App Hosting | Next.js をサーバー描画込みで公開でき、Firebase の Web 設定を自動で渡せる | 東京リージョンがない（台湾を使う） | データと API は東京に置く |
| Firebase Authentication | 参加者は匿名ですぐ参加でき、司会者は Google でログインする | 匿名アカウントは端末を変えると別人になる | 同じブラウザでの再接続を前提にし、手動テストで確かめる |
| Workload Identity 連携 | GitHub Actions から鍵なしで GCP にデプロイできる。許可するのは開発用リポジトリだけ | 設定の値（Variables）が1つ欠けても気づきにくい | デプロイの最初に6つの Variables を確かめて止める。一覧の一致を回帰テストで確かめる |

## テスト

`bash scripts/dev.sh check` が、CI と同じ次の検査を実行する。PR と `main` への push のたびに GitHub Actions が実行し、手元で通れば CI でも通る。

| 検査 | 件数 | 内容 |
|---|---|---|
| lint・型・ビルド | — | web と api |
| 単体テスト | web 2・api 12 | 表示の整形、4つの指標の計算、起動時の環境変数（空・未設定で止まる）、Gemini への生成の設定（思考レベル LOW） |
| Rules | 13 | 他人と司会者は非公開意見を読めない、別室と未ログインは読めない、本人名義・決められたフェーズでだけ書ける、など |
| API の結合 | 14 | エンドポイントごとの認可（`401`・`403`）、フェーズ（`409`）、分析の排他と30秒制限（`409`・`429`）、Gemini の失敗（`503`） |
| E2E | 3 | スマホ幅で、参加コードからの参加と非公開意見の提出 |
| 提出スクリプト | 16 | 秘密情報の検出と、検査前に提出先を変えないこと |
| 開発の入口 | 18 | CI の変更判定（9）、`dev.sh pr` の PR 作成と auto-merge の判定（9） |
| 設定の受け渡し | 21 | GitHub の Variables の一覧の一致とデプロイ前の検査、API が受け取る環境変数、クラウドのログインのプロジェクト、gcloud・ADC がないときの案内 |

Rules・API の結合・E2E は、Auth と Firestore のエミュレータと Gemini のモックで動かす。GCP の認証情報は使わない。

<!-- 提出前に記入：本番の URL での通しテスト（司会者1人＋参加者3人）と手動テスト（機内モードからの復帰、再読み込みでの再参加）の結果 -->

## ディレクトリ構成

| ディレクトリ | 内容 |
|---|---|
| [`web`](web) | 画面（Next.js）。参加コードでの参加、非公開意見の提出、`/api` の転送、E2E（Playwright） |
| [`api`](api) | API（Express + TypeScript）。認可、フェーズ、Gemini（Vertex AI とモック）、4つの指標、起動時の設定、結合テスト |
| [`firebase`](firebase) | Firestore Rules とそのテスト、ローカル用のテストデータ、固定版の Firebase CLI |
| [`infra`](infra) | 共通の変数（`env.sh`）と、GCP・GitHub の構築スクリプト |
| [`scripts`](scripts) | 開発の入口 `dev.sh`、CI の変更判定、提出スクリプト、クラウドの AI ツールのログイン |
| [`tests`](tests) | 提出スクリプト・CI の変更判定・`dev.sh pr`・設定の受け渡しの回帰テスト |
| [`.github`](.github) | CI・デプロイのワークフローと PR テンプレート |
| [`docs`](docs) | 認証情報の扱い、構築の引き継ぎ、構築手順書の写し |

## 開発に参加する

招待を受けて clone すれば、秘密情報なしで動かせる。Auth と Firestore はエミュレータ、Gemini はモックで動き、GCP には接続しない。

```bash
bash scripts/dev.sh setup    # 依存を lockfile どおりに入れる
bash scripts/dev.sh serve    # エミュレータ・テストデータ・API・画面をまとめて起動
```

http://localhost:3000 を開き、参加コード `DEMO01` で参加する。

| 環境 | 必要なもの | セットアップ |
|---|---|---|
| ローカル | Node.js 22、Java 21（Firestore エミュレータ用）。Windows は WSL | `bash scripts/dev.sh setup` |
| Dev Container・Codespaces | VS Code（Codespaces もブラウザ版ではなく VS Code から開く） | `.devcontainer` が自動で行う |
| クラウドの AI ツール | — | Claude Code は `bash .claude/cloud-setup.sh`、Codex は `bash .codex/setup.sh` |

PR の前に `bash scripts/dev.sh check` で CI と同じ検査を通し、`bash scripts/dev.sh pr` で検査・push・PR の作成・auto-merge までを1回で行う。本物の Gemini で試すときは `GEMINI_MOCK=0 bash scripts/dev.sh serve`（gcloud と ADC が要る。[CONTRIBUTING](CONTRIBUTING.md#起動する)）。

開発の流れと Git・CI のルールは [CONTRIBUTING](CONTRIBUTING.md)、AI エージェントへの指示は [AGENTS.md](AGENTS.md)、認証情報の扱いは [docs/credentials.md](docs/credentials.md) にある。

## チーム

DevFest Hackathon 2026 チーム167。

| メンバー | 役割 |
|---|---|
| Yuto | プロジェクトマネージャー・インフラエンジニア |
| Ryota | プロダクトマネージャー・バックエンドエンジニア |
| Koyuri | UX/UI デザイナー・フロントエンドエンジニア |

## ライセンス

[MIT License](LICENSE)
