# 開発への参加

開発環境の起動から PR のマージまでの進め方。人も AI エージェントも同じルールに従い、エージェント向けの手順は [AGENTS.md](AGENTS.md) にある。GCP の構築手順はチームドキュメントの「インフラ構築手順書」にある。

## 役割

| 役割 | 担当 | 責任 |
|---|---|---|
| メンバー | チームの3人 | 実装、PR の作成、CI が通った PR のマージ（だれでもよい） |
| AI エージェント | Claude Code、Codex など | 依頼者の指示による実装と検査。成果物の責任は依頼者が持つ |

## 起動する

必要なもの：Node.js（`.nvmrc` の版）、Java 21（Firestore エミュレータ用）、`gh`（PR を出すため）。GCP には接続しない。Windows では WSL の中で動かす。手元に入れたくない場合は、`.devcontainer` を VS Code の Dev Containers か GitHub Codespaces で開けば、すべて入った環境ができる（Codespaces はブラウザ版ではなく VS Code から開く。画面がエミュレータに 127.0.0.1 でつなぐため）。

```bash
bash scripts/dev.sh setup    # 依存を lockfile どおりに入れ、web/.env.local を用意する
bash scripts/dev.sh doctor   # ツールと準備の状態を確かめる
bash scripts/dev.sh serve    # エミュレータ・テストデータ・API・画面をまとめて起動する
```

http://localhost:3000 を開き、参加コード `DEMO01` で参加する。Auth と Firestore はエミュレータ、Gemini はモックで動く。Gemini が失敗したときの動きは `GEMINI_MOCK_FAIL=1 bash scripts/dev.sh serve` で確かめる。

本物の Gemini で試すときは、プロジェクトの編集者の権限で `gcloud auth application-default login` をしてから `GEMINI_MOCK=0 bash scripts/dev.sh serve` で起動する。Firestore と Auth はエミュレータのままで、Vertex AI だけ本番のプロジェクトを使う（`infra/env.sh` の PROJECT_ID・VERTEX_LOCATION・GEMINI_MODEL）。Gemini の接続先は global、Cloud Run と Firestore は東京に分けている。

クラウドの Claude Code では環境のセットアップスクリプトに `bash .claude/cloud-setup.sh` を、Codex では `bash .codex/setup.sh` を登録する。

## 開発の流れ

1. **ブランチを作る。** `git fetch origin main` のあと、最新の `origin/main` から作る。
2. **変更する。** 1つの PR では1つの目的だけを扱い、関係するテストと文書を同じ PR で更新する。
3. **PR を出す。** コミットしたら `bash scripts/dev.sh pr` を実行する。手元の検査（`check --quick`）、push、PR の作成、auto-merge の設定までを1回で行う。PR の本文にはコミットの件名が入るので、[PR テンプレート](.github/pull_request_template.md)の残りの項目を書き足す。途中で見せたいだけのときは `--no-merge` を付ける。
4. **待つ。** CI が通ると自動で squash merge され、本番に反映される。文書だけの PR では重い検査を省く。CI が落ちたら直して push すれば、同じ PR で検査がやり直される。
5. **レビューが要る PR。** Rules（`firebase/firestore.rules`）・`firebase.json`・`web/apphosting*.yaml`・ワークフロー（`.github/`）・構築スクリプト（`infra/`）を変える PR には、`pr` が auto-merge を付けない。もう1人に見てもらい、承認されたら `gh pr merge --auto --squash --delete-branch` を実行する。それ以外の PR はレビューを必須にしない。

```bash
git switch -c feat/consensus-gap-view
git commit -am "feat(web): ずれの一覧を表示する"
bash scripts/dev.sh pr
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
| `deploy`（手動） | Run workflow | ロールバック。過去にデプロイが成功したコミットだけを、Rules・API・画面ごと再デプロイする |

PR の CI は、同じブランチの新しい実行が古い実行を取り消す。`main` の実行は取り消さない。

## AI エージェントの使い方

- 依頼するときは、目的・変更してよい範囲・完了条件を書く。
- 並行して動かすエージェントには、別々のブランチと `git worktree` を割り当て、同じファイルを編集させない。
- エージェントの PR は、依頼者が中身を確かめてからマージする。マージや本番の操作は、依頼者がその PR について指示したときだけさせる。
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
