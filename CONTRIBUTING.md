# 開発への参加

開発環境の起動から本番反映までの進め方。PR の確認と本番反映の依頼の手順は、[PR の確認から本番反映までの手順](docs/contributor-preview-guide.md) にある。人も AI エージェントも同じルールに従い、エージェント向けの手順は [AGENTS.md](AGENTS.md) にある。GCP の構築手順はチームドキュメントの「インフラ構築手順書」にある。

インフラ手順書の正本を変えた場合は、関係するコードや運用ルールの変更と同じ PR で、同じ日に `docs/infra-manual.md` も更新する。写しだけを追いつかせる場合は専用 PR にする。

## 役割

| 役割 | 担当 | 責任 |
|---|---|---|
| メンバー | チームの3人 | 実装、PR の作成、プレビューの確認。本番反映は Yuto Matsui の事前承諾を受けた担当者が行う |
| AI エージェント | Claude Code、Codex など | 依頼者の指示による実装と検査。成果物の責任は依頼者が持つ |

## 起動する

必要なもの：Node.js（`.nvmrc` の版）、Java 21（Firestore エミュレータ用）、`gh`（PR を出すため）。GCP には接続しない。Windows では WSL の中で動かす。手元に入れたくない場合は、`.devcontainer` を VS Code の Dev Containers か GitHub Codespaces で開けば、すべて入った環境ができる（Codespaces はブラウザ版ではなく VS Code から開く。画面がエミュレータに 127.0.0.1 でつなぐため）。

```bash
bash scripts/dev.sh setup    # 依存を lockfile どおりに入れ、web/.env.local を用意する
bash scripts/dev.sh doctor   # ツールと準備の状態を確かめる
bash scripts/dev.sh serve    # エミュレータ・テストデータ・API・画面をまとめて起動する
```

http://localhost:3000 を開き、参加コード `DEMO01` で参加する。Auth と Firestore はエミュレータ、Gemini はモックで動く。Gemini が失敗したときの動きは `GEMINI_MOCK_FAIL=1 bash scripts/dev.sh serve` で確かめる。

先生の導線は、トップの「テスト用の先生でログイン（エミュレータ）」か、「Googleでログイン」で開く認証のエミュレータの「Add new account」から架空のメールアドレスで確かめる。本物の Google アカウントやパスワードは使わない。部屋を作ったら、表示された参加コードを別のブラウザーのプロファイルかプライベートウィンドウで入力し、架空の意見を出す。先生のダッシュボードで「未検討の論点を探す」を押すと提案が出る（通常の起動は「デモデータ」、`GEMINI_MOCK=0` では「Gemini による推定」）。

終了するときは、起動したターミナルで `Ctrl+C` を押す。Auth・Firestore のエミュレータ、API、画面をまとめて停止する。

本物の Gemini で試すときは、Google Cloud CLI（gcloud。`.devcontainer` と Codespaces には入っていない）を入れ、プロジェクトの編集者の権限で `gcloud auth application-default login` をしてから `GEMINI_MOCK=0 bash scripts/dev.sh serve` で起動する。Firestore と Auth はエミュレータのままで、Vertex AI だけ本番のプロジェクトを使う（`infra/env.sh` の PROJECT_ID・VERTEX_LOCATION・GEMINI_MODEL）。Gemini の接続先は global、Cloud Run と Firestore は東京に分けている。

クラウドの Claude Code では環境のセットアップスクリプトに `bash .claude/cloud-setup.sh` を、Codex では `bash .codex/setup.sh` を登録する。

## 開発の流れ

1. **ブランチを作る。** `git fetch origin main` のあと、最新の `origin/main` から作る。
2. **変更する。** 1つの PR では1つの目的だけを扱い、関係するテストと文書を同じ PR で更新する。
3. **PR を出す。** コミットしたら `bash scripts/dev.sh pr --no-merge` を実行する。手元の検査（`check --quick`）、push、PR の作成を1回で行い、auto-merge は付けない。PR の本文にはコミットの件名が入るので、[PR テンプレート](.github/pull_request_template.md)の残りの項目（背景・目的、検査とプレビューの結果、未確認のこと、スクリーンショット）を書き足す。
4. **画面を確かめる。** `web/` を変えた PR は、CI と並行して[プレビュー](#画面のプレビュー)に自動で出る。PR の「View deployment」からスマホでも開ける。
5. **本番反映の承諾をもらう。** `main` へのマージから自動デプロイまでを「本番反映」と呼ぶ。始める前に、必ず Yuto Matsui（GitHub：`genellect`）の承諾を得る。承諾はその PR の本番反映への1回で、マージとデプロイで2回に分けない。CI・レビュー・プレビューの成功は承諾の代わりにならない。承諾を待つ間はマージせず、auto-merge も付けない。依頼の書き方は [PR の確認から本番反映までの手順](docs/contributor-preview-guide.md) の手順4。
6. **本番反映する。** 承諾のあと、Yuto Matsui または任された担当者が、CI の成功と必要なレビューを確かめてから `bash scripts/dev.sh pr --approved` で auto-merge を付ける。CI が通ると squash merge され、`deploy` が本番に反映する。CI が落ちたら直して push すれば、同じ PR で検査がやり直される。
7. **レビューが要る PR。** Rules（`firebase/firestore.rules`）・`firebase.json`・`web/apphosting*.yaml`・ワークフロー（`.github/`）・構築スクリプト（`infra/`）を変える PR には、`--approved` でも `pr` が auto-merge を付けない。もう1人のレビューと本番反映の承諾の両方を得てから、`gh pr merge --auto --squash --delete-branch` を実行する。それ以外の PR はレビューを必須にしない。

```bash
git switch -c feat/consensus-gap-view
git commit -am "feat(web): ずれの一覧を表示する"
bash scripts/dev.sh pr --no-merge   # 検査・push・PR。Yuto Matsui の本番反映の承諾を待つ
```

## ブランチとコミット

- ブランチ名は `<種類>/<内容>`。種類は `feat`・`fix`・`docs`・`test`・`chore`・`ci` のどれか。内容は英小文字とハイフンで短く書く（例：`feat/consensus-gap-view`）。AI ツールが名前を決める場合は `claude/`・`codex/` のままでよい。
- PR のタイトルは `<種類>(<範囲>): <変更の内容>`（例：`fix(api): 分析中の再実行に 409 を返す`）。範囲は `web`・`api`・`firebase`・`infra`・`ci` のどれか。
- `main` への直接の push と force push はしない。他の人のブランチには、本人の了承なく push しない。
- マージしたブランチは自動で削除される。PR のないブランチは残さない。

## CI と本番への反映

| ワークフロー | 動くとき | すること |
|---|---|---|
| `ci` の `changes` | PR | 変更したファイルを見て、文書だけなら `test` を省く（`scripts/ci-changes.sh`） |
| `ci` の `test` | PR、`main` への push | `bash scripts/dev.sh check`：lint、型、単体テスト、ビルド、エミュレータ上の Rules・API 結合・E2E |
| `deploy` | `main` への push | CI が通ったコミットを、Rules → API（Cloud Run）→ 画面（App Hosting）の順に反映し、コミットと API のリビジョンをサマリーに記録する |
| `preview` | `web/` を変えた PR（同じリポジトリのブランチ） | 画面だけをプレビュー用のバックエンドに出す。CI とは並行で、`main` と本番は変えない |
| `deploy`（手動） | Run workflow | ロールバック。過去にデプロイが成功したコミットだけを、Rules・API・画面ごと再デプロイする |

PR の CI は、同じブランチの新しい実行が古い実行を取り消す。`main` の実行は取り消さない。

### 画面のプレビュー

フロントエンドの変更を、マージする前に実際の画面とスマホで確かめるための環境。

| 項目 | 内容 |
|---|---|
| URL | https://web-preview--devfest2026-t167.asia-east1.hosted.app （1つだけ。最後に push された PR が表示される） |
| 開き方 | PR の画面の「View deployment」、または Actions の `preview` のサマリー。どの PR・コミットが出ているかもサマリーに書かれる |
| 出るとき | `web/` を変えた PR に push したとき（ビルドに数分かかる）。ほかのブランチを出したいときは Actions → `preview` → Run workflow でブランチ名を入れる |
| API とデータ | **本番と共有**する（画面だけを差し替える）。試すときは試験用の部屋を作り、本番の部屋は使わない |
| ログイン | 匿名参加も Google ログインも使える（URL は `infra/setup-preview.sh` が承認済みドメインに加える） |

プレビューを出すワークフローとスクリプトは、`main` にあるものが動く。PR からは `web/` のファイルだけを使うので、`preview.yml` や `infra/` を変える PR は、マージされるまでプレビューに効かない（PR のコードが GCP の認証で動かないようにするため）。

2人が同時に画面の PR を出すと、後から push した方が表示される。確かめたい PR がいま出ているかは、PR の「View deployment」が Active かどうかで分かる。API や Rules の変更はプレビューでは確かめられない（本番の API を使うため）。手元の `bash scripts/dev.sh serve` で確かめる。

## Gemini のモデルと費用

Gemini の費用は、ほぼ「モデル」と「思考レベル」で決まる（接続方式を Gemini API に替えても、1トークンあたりの料金はほぼ同じ）。思考に使ったトークンも出力として課金される。

| 項目 | 今の設定 | 置き場所 |
|---|---|---|
| モデル | `gemini-3.5-flash`（2027-05-19 以降まで提供） | `infra/env.sh` と GitHub の Variables の `GEMINI_MODEL` |
| 接続先 | `global`（東京では通常の従量課金がない） | `infra/env.sh` と Variables の `VERTEX_LOCATION` |
| 思考レベル | `LOW`（既定の `MEDIUM` より費用が約半分） | `api/src/gemini.ts` の `GENERATION_CONFIG` |
| temperature | 0 | 同上 |

### 次に検討すること：Flash-Lite への切り替え（未決定）

`gemini-3.5-flash-lite` は、思考 LOW どうしで今の約4分の1、思考 MEDIUM だった頃の約8分の1の費用になる見込み（第三者の料金表から計算）。ただし精度は低めとされるので、**本物のデータで比べてから**決める。モデルの変更は依頼者が承認した方針の変更なので、比べた結果を PR に貼り、依頼者の承認を得てから切り替える。

1. 比べる議論を1つ決める。手元のエミュレータで部屋を作り、事前意見4件・発言20件・合意の一文3件を、2回とも同じ文で入れる（本番の部屋の本文は使わない）。
2. 今のモデルで、未検討論点の分析と合意の分析を実行し、提案された論点（`insights`）と合意のまとまり（`results/summary`）を記録する。
   ```bash
   GEMINI_MOCK=0 bash scripts/dev.sh serve
   ```
3. Flash-Lite で同じ操作をして記録する。起動時の表示に `gemini-3.5-flash-lite` と出ることを確かめる。
   ```bash
   GEMINI_MODEL_OVERRIDE=gemini-3.5-flash-lite GEMINI_MOCK=0 bash scripts/dev.sh serve
   ```
4. 次の観点で表にする。

   | 観点 | 確かめ方 |
   |---|---|
   | 未検討論点の取りこぼし・誤り | 人が入れた「まだ話していない論点」が出るか。話した論点を未検討と言わないか |
   | 論点の要約 | 司会者がそのまま全員に見せられる文か。個人が特定できる表現がないか |
   | 合意のまとまり | 意味が同じ一文が同じまとまりに入るか（認識一致度が人の判断と合うか） |
   | 失敗の回数 | JSON の形が崩れて `503` になった回数 |
   | 応答時間 | 分析ボタンを押してから結果が出るまで |
5. 差が小さければ、切り替えの PR を出す。`infra/env.sh` の `GEMINI_MODEL` を変え（`tests/config.test.sh` が値を確かめる）、マージの前に GitHub の Variables の `GEMINI_MODEL` を同じ値にする。
6. Flash-Lite が思考レベル `LOW` に対応せず `400` になるときは、対応している思考レベルを公式のモデル情報で確かめ、`GENERATION_CONFIG` と一緒に比べ直す。

## AI エージェントの使い方

- 依頼するときは、目的・変更してよい範囲・完了条件を書く。
- 並行して動かすエージェントには、別々のブランチと `git worktree` を割り当て、同じファイルを編集させない。
- エージェントも PR を `bash scripts/dev.sh pr --no-merge` で出す。本番反映（マージと auto-merge を含む）は、Yuto Matsui がその PR の本番反映を承諾したときだけさせる。本番の GCP の操作も、依頼者が指示したときだけさせる。
- エージェントが付ける `Co-Authored-By` 行はコミットに残す。
- 引き継ぎは PR の説明に書く。セッションごとの引き継ぎ文書は作らない。

## 秘密情報

リポジトリに秘密情報は置かない。実装担当が PR を出すだけなら、秘密情報は1つも要らない。必要な値は次の場所にだけ置く。だれが持ち、どう渡し、どう止めるかは [認証情報の引き継ぎ](docs/credentials.md) にある。

| 値 | 置き場所 |
|---|---|
| デプロイの設定（PROJECT_ID など6つ） | GitHub の Actions の Variables。鍵ではない |
| クラウドの Claude Code 用の鍵 | Claude Code の環境変数 `GCP_SA_KEY` |
| クレジットコード | どこにも書かない（代表者だけが使う） |

提出用リポジトリへの反映は `scripts/submit.sh` が秘密情報を検査してから行う。値はチャット、Issue、PR、ログ、スクリーンショットに貼らない。
