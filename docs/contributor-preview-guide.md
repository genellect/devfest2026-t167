# PR の確認から本番反映までの手順

PR を確かめ、プレビューで画面を見て、本番反映の承諾をもらうまでの手順。手順1〜5は、チームドキュメントの「【重要】PRの確認から本番反映までの手順」タブ（正本）と同じ内容。そのあとに、コードを変える人の準備・ビルドとログの見方・困ったときを加えている。

## はじめに：大事な決まり

- **PR** は「変更の提案」、**CI** は「自動の検査」です。PR を作っただけでは、本番には反映されません。
- `main` へのマージから自動デプロイまでを、まとめて **「本番反映」** と呼びます。
- **本番反映の前に、必ず Yuto Matsui さん（GitHub：`genellect`）の承諾をもらいます。** 承諾は、本番反映1回につき1回だけです。
- CI の成功、レビュー、プレビューの成功は、どれも承諾の代わりになりません。承諾をもらうまでは、マージも auto-merge もしません。

### 言葉

| 言葉 | 意味 |
|---|---|
| ブランチ | 自分の変更を置く作業場所。`main`とは別に作る |
| コミット | 変更をひとまとまりで記録すること |
| PR（Pull Request） | 変更をチームに見てもらうための提案 |
| CI | GitHubが自動で行うコードの検査 |
| プレビュー | PRの画面を、マージ前にPCやスマホで確認する場所 |
| 本番 | 利用者が使う公開中のアプリ |

> プレビュー環境は、いま初めての構築を確かめているところです。うまく表示されないときは、担当者に知らせてください。

## 手順1　確認する PR を開く

[PR の一覧](https://github.com/genellect/devfest2026-t167/pulls)を開き、確認する PR を選びます。

## 手順2　自動検査とプレビューの結果を見る

PR の画面の下、または「Checks」タブで、次の2つが緑（成功）になっているかを見ます。

| 表示名 | 意味 | 緑でないとき |
|---|---|---|
| `ci / test` | コードの自動検査 | 文書だけの PR では「skipped（省略）」になります。これは正常です |
| `preview` | プレビュー画面の公開 | `web/`（画面）を変えていない PR では動きません。これも正常です |

赤（失敗）になっていたら、その実行のページの URL をコピーして担当者に伝えます。

## 手順3　PC とスマホで画面を確かめる

PR の画面の「View deployment」から開きます。Actions の実行結果の「Summary」にある URL からも開けます。

プレビューの URL：https://web-preview--devfest2026-t167.asia-east1.hosted.app

確かめること：

- [ ] Summary に書かれた PR とコミットが、確認したい変更と同じである
- [ ] PC でもスマホでも、表示が崩れていない
- [ ] ボタンや入力欄が、思ったとおりに動く

**注意**

- プレビューの URL は、全員で1つです。あとから別の PR が出ると、その PR の画面に切り替わります。
- API とデータは本番と同じものを使います。担当者が用意した**試験用の部屋**（参加コード）と、**架空の文章**で試してください。本物の意見は書き込みません。

## 手順4　結果を書き、本番反映の承諾をお願いする

PR のコメント欄に、次をコピーして書き込みます。

```text
確認したPR・コミット：
PCで確認したこと：
スマホで確認したこと：
問題・まだ確認していないこと：

Yuto Matsuiさん、このPRを本番反映してよいか、承諾をお願いします。
```

承諾をもらうまでは、マージも auto-merge もしません。

## 手順5　承諾のあと、本番で確かめる

本番反映は、Yuto Matsui さん、または Yuto さんが任せた担当者が行います。承諾された PR には、担当者が `bash scripts/dev.sh pr --approved`（または `gh pr merge --auto --squash --delete-branch`）で auto-merge を付けます。Rules・ワークフロー・構築スクリプトを変える PR は、もう1人のレビューも済ませてから付けます。

反映したら、次を確かめます。

1. [Actions](https://github.com/genellect/devfest2026-t167/actions) で、そのコミットの `deploy` が最後まで成功（緑）している。
2. [本番の画面](https://web--devfest2026-t167.asia-east1.hosted.app)を開き、変更した部分が思ったとおりになっている。
3. 必要なら、[API の稼働確認](https://web--devfest2026-t167.asia-east1.hosted.app/api/health)を開く（`/api/healthz` でも同じ結果が返る）。次のように表示されれば、API は動いています。

   ```text
   {"ok":true,"gemini":"gemini"}
   ```

   ただし、これは「API が動いている」ことしか表しません。Gemini の分析が成功するかどうかは、画面で実際に試して確かめます。

## 自分でコードを変えて PR を出すとき

画面を確かめるだけの人は A でリポジトリを開けることを確かめたら、上の手順1から進める。コードを変える人は A〜D を行ってから、手順2以降に進む。環境の詳しい説明は [CONTRIBUTING](../CONTRIBUTING.md) にある。

### A. リポジトリを開けることを確かめる

[開発用リポジトリ](https://github.com/genellect/devfest2026-t167)に、自分のGitHubアカウントでログインする。招待が届いている場合は受け入れる。

| メンバー | GitHubアカウント | リポジトリの権限 |
|---|---|---|
| Yuto Matsui | genellect | Admin |
| Ryota | ryota-murakami-dev | Write |
| Koyuri | yamakoyu1017 | Write |

PRとプレビューのために、GCPの鍵やトークンを受け取る必要はない。リポジトリに書き込めない場合は、Yuto MatsuiにGitHubアカウント名と困っている画面を伝える。

### B. 開発環境を開く（初回だけ）

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

### C. 自分のブランチで変更する

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

パソコンで http://localhost:3000 を開き、参加コード`100001`で試す。この環境ではAuth・Firestoreはエミュレータ、Geminiはモックを使う。ローカルでの確認は本番の動作確認とは別になる。終了するときはターミナルで`Ctrl+C`を押す。

### D. 検査し、PR を出す

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

## ビルドやログを見る（必要な人だけ）

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
