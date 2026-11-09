# T167 エージェント向け指示

このリポジトリで作業する AI エージェント（Claude Code、Codex など）への指示。開発の進め方の正本は [CONTRIBUTING](CONTRIBUTING.md) で、この文書はそれをエージェントの手順にしたもの。GCP・Firebase・GitHub の構築と運用の手順は [インフラ構築手順書](docs/infra-manual.md) が正本で、認証情報は [credentials](docs/credentials.md) にある。文書どうしやコードと食い違う場合は、コードと設定で事実を確かめ、直す前に依頼者に確認する。

## 作品

**Topos — 誰の考えも埋もれない議論を、すべての教室に。** グループディスカッションで埋もれた考えを AI が見つけ、全員の考えが活かされる議論にするための学習支援アプリ（DevFest Hackathon 2026・教育カテゴリ）。価値の中枢は、発言率の可視化、音声認識による未検討の論点の可視化、事前の意見から結論への主張の変化の確認の3機能。プロダクト名は画面・文書とも「Topos」に統一する（由来は README「Topos という名前」）。

利用者と権限：全員が Google でログインする。Googleでログイン済みなら、教師・生徒に関係なく議論を作成・参加できる（2026-11-09の依頼者の最新指示）。作成後の Host/Participant は議論ごとの members.role で判定する。ログイン後は教員・学生とも共通ホーム（`/home`）へ進み、QR・参加リンクでは参加画面（`/join`）を優先する。ログインの上限は全員1台。詳細は [MVPロール設計](docs/mvp-roles.md)。

| 優先順位 | 内容 |
|---|---|
| 1 | 3機能（発言率の可視化、音声認識による未検討の論点の可視化、事前の意見から結論への主張の変化の確認）が、本番の URL で通しで動く |
| 2 | 審査で示す証拠（README の構成図と選定理由、テスト結果、デモ動画）がそろう |
| 3 | それ以外の改善 |

締切は 2026-11-10 19:00。開発速度を最優先にし、確認の手間を増やす仕組みは足さない。

2026-11-09の依頼者の最新指示により、Docsの旧「招待された教員だけが作成」と異なり、Host/Guestはセッションごとに決める。作成者がHost、参加者がGuestとなる。Classroomの名簿閲覧と学校ポリシー管理は、それぞれGoogleのクラス役割・schoolAdminの認可を維持する。この明示指示を優先したことをPRに記録する。

## 常に守ること

- クレジットコード、サービスアカウントの鍵（`GCP_SA_KEY`）、トークンを、コード・ログ・Issue・PR・スクリーンショットに書かない。このリポジトリも提出用リポジトリも公開されている。
- 非公開の事前意見の本文を、本人以外（司会者、他の参加者、ログ）に出さない。Rules と API の両方で守る（`firebase/firestore.rules`、`api/src/app.ts`）。
- 実行していない・失敗した検査を、通ったと報告しない。
- `main` へのマージから自動デプロイまでを「本番反映」と呼ぶ。本番反映は、Yuto Matsui（GitHub：`genellect`）がその PR の本番反映を事前に承諾したときだけ行う。承諾は本番反映への1回で、マージとデプロイで分けない。実装・push・PR 作成の依頼や、CI・レビュー・プレビューの成功は、承諾の代わりにならない。
- 提出用リポジトリ（Devfest-Hackathon-2026/df-2026-t167）への commit と push は人が行う。エージェントは `scripts/submit.sh` の実行までにとどめる。

## チームドキュメントを毎回読む

実装を始める前と PR を出す前に、毎回、チームドキュメント（Google Docs）のすべてのタブを読み、プロダクトの方向性を理解してから実装に進む。

- 文書：https://docs.google.com/document/d/1zHg74msQ1xBgsautfcQNsv-dDlQcO4WqzbV0ZDNnv5A/edit
- Claude も Codex も、Google Docs の接続で読む。子タブと表の中身も含めて全文を読む。対象は、要件定義・アプリの構想・MVPフロー・タブ 14（サービス形態）・UIフィードバックとその子タブ（サーバーフィードバックなど）・アプリフィードバック・審査基準・市場分析とその子タブ・ディスカッションテーマ例・開発計画・プロダクト・チーム案・【重要】PRの確認から本番反映までの手順と、新しく増えたタブのすべて。
- 「審査基準」タブは画像と、その文字起こしからなる。文字の部分を読む。
- 実装案が文書の方向性、特に最新のフィードバックと合っているかを確かめ、PR の説明に「読んだタブと、方向性との対応」を書く。タブどうし、またはタブとコードが食い違うときは、新しいフィードバックを優先し、その判断を PR に書く。作品の目的が変わるような食い違いは、直す前に依頼者に確認する。
- 文書を読めなかったときは、推測で進めず、そのことを依頼者に報告する。
- 文書にある個人情報（連絡先・住所など）は、コード・PR・ログに写さない。

「インフラ構築手順書」タブは、リポジトリの [docs/infra-manual.md](docs/infra-manual.md) への案内だけになっている。GCP・Firebase・GitHub の構築・権限・デプロイ・CI を変えるときは、リポジトリの手順書を読み、同じ PR で更新する。メンバーのメールアドレスは手順書に書かない（実行するときに引数で渡す）。

## 作業の手順

1. 上のチームドキュメント、この文書、[README](README.md)、[CONTRIBUTING](CONTRIBUTING.md)、変更するコードとそのテストを読む。
2. `git status` で未コミットの作業を確かめ、`git fetch origin main` のあと、最新の `origin/main` からブランチを作る。名前は `<種類>/<内容>`（[CONTRIBUTING](CONTRIBUTING.md#ブランチとコミット)）。ツールが名前を決める場合は `claude/`・`codex/` のままでよい。
3. 並行して動くエージェントとは、別のブランチと `git worktree` を使い、割り当てられたファイルだけを変える。他の人やエージェントが使っている checkout は編集しない。
4. 1つの PR では1つの目的だけを扱う。次の組は同じ PR で変える。
   - API のエンドポイント → `web/` の呼び出し、`api/test/integration`、[API と認可](docs/api.md)の表（読める人が変わるなら README の「プライバシーとセキュリティ」の表も）
   - `firebase/firestore.rules` → `firebase/test/rules.test.mjs`
   - 指標の計算（`api/src/metrics.ts`）→ 単体テストと README の指標の表
   - 起動・検査の手順 → `scripts/dev.sh`、README、CONTRIBUTING
   - 構築・権限・デプロイ・CI（`infra/`・`.github/`・`firebase.json`・`web/apphosting.yaml`）→ [インフラ構築手順書](docs/infra-manual.md)（GitHub の Variables を増減したら `docs/credentials.md` と `infra/setup-deployer.sh` も。`tests/config.test.sh` が一致を確かめる）
   - Gemini のモデル・思考レベル → [CONTRIBUTING](CONTRIBUTING.md#gemini-のモデルと費用) の手順で今の設定と比べた結果を PR に貼る。モデルの変更は依頼者の承認を得てから
5. `bash scripts/dev.sh check` を通す。CI とまったく同じ検査で、通らなければ PR を出さない。PR は `bash scripts/dev.sh pr --no-merge` で出す（手元の検査、push、PR の作成まで行う）。
6. PR は[テンプレート](.github/pull_request_template.md)のすべての項目を書く。実行したコマンドと結果を書き、未実施・失敗・残る制約を分けて書く。画面を変えたらスマホ幅のスクリーンショットを貼る。
7. PR を出す前に、チームドキュメントを読み直して方向性と合っているかを確かめ、[CONTRIBUTING](CONTRIBUTING.md) の開発のルールを読み直す。PR を出したら、[PR の確認から本番反映までの手順](docs/contributor-preview-guide.md)に従い、プレビューの結果と本番反映の承諾の依頼を PR に書く。Yuto Matsui がその PR の本番反映を承諾した場合だけ、`bash scripts/dev.sh pr --approved` で auto-merge を付ける（PR がすでにあれば auto-merge だけを付ける）。auto-merge は CI が通った head だけをマージし、後から push すると CI をやり直すので、確かめていないコミットはマージされない。Rules・ワークフロー・構築スクリプト・AI 用の鍵を使うセッションの設定（`.claude/`・`.codex/`）を変えた PR には `--approved` でも auto-merge が付かないので、レビューを待つよう依頼者に伝える。
8. 引き継ぎは PR の説明に書く。セッションごとの引き継ぎ文書は作らない。

## 報告

- 依頼者への報告は日本語で書く。
- 「実装した」「CI が通った」「本番に反映した」「本番の URL で動作を確かめた」を、確かめた事実として分けて書く。
