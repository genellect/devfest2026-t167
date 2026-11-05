# はじめてのPR・プレビュー確認・本番反映

対象：このプロジェクトに参加し、画面やコードを変更するcontributor。クラウドの構築や権限設定は担当者が済ませるので、この手順では行わない。

画面を確認するだけの人は「1」でリポジトリへのアクセスを確かめたあと、「5」から進める。コードを変更しない場合、手元の開発環境を準備する必要はない。

## 最初に覚えること

**mainへのマージから自動デプロイまでを、まとめて「本番反映」と呼ぶ。本番反映を始める前に、必ずYuto Matsui（GitHub：genellect）の承諾を得る。承諾は「このPRを本番反映してよいか」の1回にまとめる。**

PRは変更の提案であり、本番反映ではない。CIやプレビューが成功したことも、Yuto Matsuiの承諾にはならない。承諾待ちのPRはマージせず、auto-mergeも有効にしない。承諾後の操作は、Yuto MatsuiまたはYutoが任せた担当者が行う。

| 言葉 | 意味 |
|---|---|
| ブランチ | 自分の変更を置く作業場所。`main`とは別に作る |
| コミット | 変更をひとまとまりで記録すること |
| PR（Pull Request） | 変更をチームに見てもらうための提案 |
| CI | GitHubが自動で行うコードの検査 |
| プレビュー | PRの画面を、マージ前にPCやスマホで確認する場所 |
| 本番 | 利用者が使う公開中のアプリ |

## 1. リポジトリを開けることを確認する

[開発用リポジトリ](https://github.com/genellect/devfest2026-t167)に、自分のGitHubアカウントでログインする。招待が届いている場合は受け入れる。

| メンバー | GitHubアカウント | リポジトリの権限 |
|---|---|---|
| Yuto Matsui | genellect | Admin |
| Ryota | ryota-murakami-dev | Write |
| Koyuri | yamakoyu1017 | Write |

PRとプレビューのために、GCPの鍵やトークンを受け取る必要はない。リポジトリに書き込めない場合は、Yuto MatsuiにGitHubアカウント名と困っている画面を伝える。

## 2. 開発環境を開く（初回だけ）

手元にNode.js 22・Java 21・Git・GitHub CLI（`gh`）が入った環境、またはVS Codeから開いたCodespacesを使う。Windowsで以下のBashコマンドを実行する場合は、開発環境のWSLターミナルを使う。CodespacesはVS Codeから接続する。ブラウザ版だけでは、画面とエミュレータの接続がうまくいかないことがある。

すでにリポジトリを開いている人はcloneを繰り返さず、そのフォルダのターミナルを開く。

```bash
git clone https://github.com/genellect/devfest2026-t167.git
cd devfest2026-t167
bash scripts/dev.sh setup
bash scripts/dev.sh doctor
gh auth login
```

`gh auth login`では、自分のGitHubアカウントでログインする。認証コードやトークンをPRやチャットに貼らない。

`doctor`でNode.js・Java・依存関係に問題がなければ準備完了。gcloud・ADCの案内は、本物のGeminiを試す人向けで、通常の開発とPRには不要。

## 3. 自分のブランチで変更する

まず、次で作業中の変更がないか確認する。

```bash
git status
```

変更が残っていたら、消したり別のブランチに移したりする前に、その作業をどう扱うか確認する。変更がない状態で、最新のmainから自分のブランチを作る。

```bash
git fetch origin main
git switch -c feat/update-join-screen origin/main
```

`feat/update-join-screen`は例。同じ名前を再利用せず、変更内容に合う名前にする。`main`の上で直接変更しない。

ローカルの画面を起動する。

```bash
bash scripts/dev.sh serve
```

パソコンで http://localhost:3000 を開き、参加コード`DEMO01`で試す。この環境ではAuth・Firestoreはエミュレータ、Geminiはモックを使う。ローカルでの確認は本番の動作確認とは別になる。終了するときはターミナルで`Ctrl+C`を押す。

## 4. 検査し、PRを出す

起動中の`serve`を止めてから、次を実行する。

```bash
bash scripts/dev.sh check
git status
```

`OK: CI と同じ検査がすべて通りました`と出ることを確認する。初回にブラウザ不足と出た場合は、次を実行してからもう一度検査する。

```bash
cd web
npx playwright install chromium
cd ..
```

`git status`で確認した、自分が変更したファイルだけをコミットする。次のファイル名とメッセージは例なので、実際の変更に合わせる。

```bash
git add web/src/app/page.tsx
git commit -m "feat(web): improve the join screen"
bash scripts/dev.sh pr --no-merge
```

**`--no-merge`を省略しない。** このコマンドは手元の検査・push・PR作成を行い、本番反映を自動で予約しない。表示されたPRのURLを開き、次を書く。

- 何を変えたか、なぜ変えたか
- 実行した検査と結果
- PCとスマホ幅のスクリーンショット（画面を変えた場合）
- 未確認のこと、相談したいこと

## 5. PRのプレビューを確認する

プレビュー機能の導入後は、同じリポジトリのブランチで`web/`を変えたPRに、CIと並行して`preview`が動く。文書だけ、APIだけ、RulesだけのPRでは、画面のプレビューが動かない場合がある。

1. PRの`Checks`、または[Actions](https://github.com/genellect/devfest2026-t167/actions)を開く。
2. 自分のPR・コミットの`preview`が緑になるまで待つ。`ci`と`preview`は別の結果なので、両方を確認する。
3. PRの`View deployment`、または`preview`実行の`Summary`にあるURLを開く。
4. SummaryのPR番号とコミットが、自分の変更と一致することを確認する。
5. 同じURLをスマホでも開き、表示や入力を確かめる。

プレビューURL： https://web-preview--devfest2026-t167.asia-east1.hosted.app

URLは共通で、更新に成功した最新のPRの画面が表示される。新しいpushの直後やビルド失敗時には、前の画面が残ることがある。自分の変更が出ていなければ、PR番号・コミット・実行結果を確認する。

プレビューはURLを知っていれば閲覧できる。API・Authentication・データは本番と共有するため、試験用の部屋と架空の文章で確認する。ローカル専用の`DEMO01`がプレビューでも使えるとは限らない。参加テストには担当者が用意した試験用の参加コードを使う。

APIやRulesの変更の確認は、手元のエミュレータと`check`で行う。プレビューの画面から呼ばれるAPIは、本番反映済みのAPIになる。

## 6. 確認結果をPRに書き、本番反映を依頼する

次をコピーして、結果を埋める。

```text
変更内容：
PR番号・コミット：
CI：成功／失敗
preview：成功／失敗／対象外
PCで確認したこと：
スマホで確認したこと：
未確認のこと：

Yuto Matsuiさん、このPRを本番反映してよいか、承諾をお願いします。
```

承諾が来るまでPRをマージせず、auto-mergeや本番の`deploy`を実行しない。Yuto Matsuiの承諾後は、任された担当者がmainへのマージを進める。そこから本番デプロイが自動で始まるため、マージとデプロイで承諾を2回に分ける必要はない。

## 7. 本番反映の結果を確認する

1. [Actions](https://github.com/genellect/devfest2026-t167/actions)で、対象のコミットの`deploy`を開く。
2. CIに加えて、デプロイ全体が成功したことを確認する。途中のRulesやAPIだけの成功では、画面まで反映できたとは限らない。
3. Summaryのコミットが、承諾された変更と一致することを確認する。
4. [本番の画面](https://web--devfest2026-t167.asia-east1.hosted.app)で、変更した部分を確かめる。
5. [APIの疎通確認URL](https://web--devfest2026-t167.asia-east1.hosted.app/api/health)を開き、`{"ok":true,"gemini":"gemini"}`を確認する。元の確認URL `/api/healthz` の互換転送はPR #12の反映後に使える。これはAPIの接続設定の確認で、実際にGeminiの分析が成功した証拠にはならない。

結果は「実装した」「CIが通った」「本番に反映した」「本番URLで確かめた」を分けてPRに記録する。本番で問題を見つけたら、PR番号・URL・再現手順をYuto Matsuiに伝える。自分の判断で本番の再実行やロールバックを始めない。

## 8. ビルドやログを見る（必要な人だけ）

通常の確認は、GitHubのPRとActionsだけで行える。Firebase側のビルドやログも見る場合は、[Firebaseコンソール](https://console.firebase.google.com/project/devfest2026-t167)を、権限を付与された自分のGoogleアカウントで開く。

App Hostingで、本番は`web`、プレビューは`web-preview`を選ぶ。ビルド・ロールアウトのコミットとエラーを確認する。アクセスできなければ、利用したアカウントとURLをYuto Matsuiへ個別に伝える。公開PRに個人のメールアドレスや認証情報を貼る必要はない。

## 困ったとき

| 状況 | まずすること |
|---|---|
| `gh`のログインエラー | `gh auth login`で自分のGitHubにログインする |
| `mainでは実行できません` | 作業用ブランチか確認する。mainのままPR作成を進めない |
| コミットしていない変更がある | `git status`を見て、自分の変更をコミットする |
| CIが赤い | 失敗した検査を開き、同じPRのブランチで修正してコミットし、再び`pr --no-merge`を実行する |
| previewがない | `web/`を変えたPRか確認する。導入・権限・初回作成の問題なら、PRと実行URLをYuto Matsuiに伝える |
| previewが赤い | 実行URLと最初のエラーを共有する。鍵やトークンを貼らない |
| 他の人の画面が出る | 共通URLなので、SummaryのPR番号・コミットを確認する |
| Googleログインができない | 利用したURLとエラー名を担当者に伝える。権限や認証設定を自分で変更しない |
| 本番deployが赤い | 本番反映が完了したとは報告せず、対象の実行URLをYuto Matsuiに伝える |

クラウドの権限・請求・WIF・Firebaseの初回設定は、[インフラ構築手順書](infra-manual.md)と[認証情報の扱い](credentials.md)を参照する。このマニュアルには認証情報や個人のメールアドレスを記載しない。
