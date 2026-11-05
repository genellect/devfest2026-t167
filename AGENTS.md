# T167 エージェント向け指示

このリポジトリで作業する AI エージェント（Claude Code、Codex など）への指示。開発の進め方の正本は [CONTRIBUTING](CONTRIBUTING.md) で、この文書はそれをエージェントの手順にしたもの。GCP の構築手順はチームドキュメントの「インフラ構築手順書」にあり、その写しが [docs/infra-manual.md](docs/infra-manual.md) にある。いま依頼している開発インフラとクラウドの構築は [docs/codex-handoff.md](docs/codex-handoff.md) にまとめている。文書どうしやコードと食い違う場合は、コードと設定で事実を確かめ、直す前に依頼者に確認する。

## 作品

議論の前に全員の意見を非公開で集め、Gemini が「まだ議論されていない論点」と「合意の中身のずれ」を見つけて司会者に知らせる Web アプリ（DevFest Hackathon 2026・教育カテゴリ）。

| 優先順位 | 内容 |
|---|---|
| 1 | MVP の3機能（事前意見収集、未検討論点の検出、合意の実態検証）が、本番の URL で通しで動く |
| 2 | 審査で示す証拠（README の構成図と選定理由、テスト結果、デモ動画）がそろう |
| 3 | それ以外の改善 |

締切は 2026-11-10 19:00。開発速度を最優先にし、確認の手間を増やす仕組みは足さない。

## 常に守ること

- クレジットコード、サービスアカウントの鍵（`GCP_SA_KEY`）、トークンを、コード・ログ・Issue・PR・スクリーンショットに書かない。このリポジトリも提出用リポジトリも公開されている。
- 非公開の事前意見の本文を、本人以外（司会者、他の参加者、ログ）に出さない。Rules と API の両方で守る（`firebase/firestore.rules`、`api/src/app.ts`）。
- 実行していない・失敗した検査を、通ったと報告しない。
- `main` へのマージから自動デプロイまでを「本番反映」と呼ぶ。本番反映は、Yuto Matsui（GitHub：`genellect`）がその PR の本番反映を事前に承諾したときだけ行う。承諾は本番反映への1回で、マージとデプロイで分けない。実装・push・PR 作成の依頼や、CI・レビュー・プレビューの成功は、承諾の代わりにならない。
- 提出用リポジトリ（Devfest-Hackathon-2026/df-2026-t167）への commit と push は人が行う。エージェントは `scripts/submit.sh` の実行までにとどめる。

## 手順書を毎回読む

実装を始める前と PR を出す前に、毎回、チームの手順書を読み、そのとおりに実行する。

- 正本はチームドキュメントの「インフラ構築手順書」タブ：https://docs.google.com/document/d/1zHg74msQ1xBgsautfcQNsv-dDlQcO4WqzbV0ZDNnv5A/edit?tab=t.t1975sujc4nn
- Claude も Codex も、Google Docs の接続で正本を読む。正本と写しの [docs/infra-manual.md](docs/infra-manual.md) が違っていたら、正本に従い、違いを依頼者に知らせる。
- 正本を読めなかったときだけ写しを読み、そのことを報告する。
- 正本を変えた人は、関係するコードや運用ルールの変更と同じ PR で、同じ日に `docs/infra-manual.md` も更新する。写しだけを追いつかせる場合は専用 PR にする。メンバーのメールアドレスは写しに入れない。

## 作業の手順

1. 上の手順書、この文書、[README](README.md)、[CONTRIBUTING](CONTRIBUTING.md)、変更するコードとそのテストを読む。
2. `git status` で未コミットの作業を確かめ、`git fetch origin main` のあと、最新の `origin/main` からブランチを作る。名前は `<種類>/<内容>`（[CONTRIBUTING](CONTRIBUTING.md#ブランチとコミット)）。ツールが名前を決める場合は `claude/`・`codex/` のままでよい。
3. 並行して動くエージェントとは、別のブランチと `git worktree` を使い、割り当てられたファイルだけを変える。他の人やエージェントが使っている checkout は編集しない。
4. 1つの PR では1つの目的だけを扱う。次の組は同じ PR で変える。
   - API のエンドポイント → `web/` の呼び出し、`api/test/integration`、README の認可の表
   - `firebase/firestore.rules` → `firebase/test/rules.test.mjs`
   - 指標の計算（`api/src/metrics.ts`）→ 単体テストと README の指標の表
   - 起動・検査の手順 → `scripts/dev.sh`、README、CONTRIBUTING
   - Gemini のモデル・思考レベル → [CONTRIBUTING](CONTRIBUTING.md#gemini-のモデルと費用) の手順で今の設定と比べた結果を PR に貼る。モデルの変更は依頼者の承認を得てから
5. `bash scripts/dev.sh check` を通す。CI とまったく同じ検査で、通らなければ PR を出さない。PR は `bash scripts/dev.sh pr --no-merge` で出す（手元の検査、push、PR の作成まで行う）。
6. PR は[テンプレート](.github/pull_request_template.md)のすべての項目を書く。実行したコマンドと結果を書き、未実施・失敗・残る制約を分けて書く。画面を変えたらスマホ幅のスクリーンショットを貼る。
7. PR を出す前に、手順書の「開発のルール」と「実装担当の開発 UX（到達条件）」を読み直す。PR を出したら、[PR の確認から本番反映までの手順](docs/contributor-preview-guide.md)に従い、プレビューの結果と本番反映の承諾の依頼を PR に書く。Yuto Matsui がその PR の本番反映を承諾した場合だけ、`bash scripts/dev.sh pr --approved` で auto-merge を付ける（PR がすでにあれば auto-merge だけを付ける）。auto-merge は CI が通った head だけをマージし、後から push すると CI をやり直すので、確かめていないコミットはマージされない。Rules・ワークフロー・構築スクリプトを変えた PR には `--approved` でも auto-merge が付かないので、レビューを待つよう依頼者に伝える。
8. 引き継ぎは PR の説明に書く。セッションごとの引き継ぎ文書は作らない。

## 報告

- 依頼者への報告は日本語で書く。
- 「実装した」「CI が通った」「本番に反映した」「本番の URL で動作を確かめた」を、確かめた事実として分けて書く。
