# 認証情報の引き継ぎ

チーム167の認証情報を、だれが持ち、どう渡し、どう止めるかをまとめる。認証情報の正本はこの文書で、[インフラ構築手順書](infra-manual.md)からはここを参照する。この文書には値を一切書かない。

## 原則

- **実装担当が PR を出すだけなら、秘密情報は1つも要らない。** 手元の開発はエミュレータと Gemini のモックで動き、GitHub Actions から GCP へは鍵を使わない WIF で認証する。GitHub の Secrets も使わない。
- **秘密情報は渡さない。必要な人が自分で発行する。** 鍵やトークンを、チャット・メール・Issue・PR・ログ・スクリーンショット・リポジトリに貼らない。開発用リポジトリも提出用リポジトリも公開されている。
- **止め方を先に決めておく。** 人が抜けたとき、ハッカソンが終わったとき、漏れたときに、だれが何を消すかを下の表に決めてある。

## 一覧

| 認証情報 | 秘密か | 持つ人・置き場所 | 実装担当に要るか | 渡し方 | 止め方 |
|---|---|---|---|---|---|
| クレジットコード | 秘密 | 代表者だけ。引き換えた後は不要 | 要らない | 渡さない（運営の規約でチーム外への共有と公開を禁止） | — |
| 請求先アカウント | 権限 | 代表者（請求先の管理者） | 要らない | 予算の通知を受けたい人だけ、代表者が請求先の閲覧者に加える | 代表者が請求先の権限から外す |
| GCP プロジェクトの編集者 | 権限 | 各自の Google アカウント | 任意（本番のログや Firestore を見るとき） | オーナーが `bash infra/setup-members.sh <メールアドレス>` で付ける（[手順書](infra-manual.md)の手順9）。本人は `gcloud auth login` | オーナーが IAM から外す |
| 手元の ADC | 秘密（各自の PC の中） | 各自の PC | 任意（手元から本物の Gemini を試すとき。`GEMINI_MOCK=0 bash scripts/dev.sh serve`） | 本人が `gcloud auth application-default login` | 本人が `gcloud auth application-default revoke` |
| 開発用リポジトリの書き込み権限 | 権限 | 各自の GitHub アカウント | 要る（PR とプレビューを出すため） | オーナーが `bash infra/setup-members.sh <GitHub のユーザー名>` で招待し、本人が受け入れる | オーナーが Collaborator から外す |
| 提出用リポジトリの書き込み権限 | 権限 | 各自の GitHub アカウント | 締切前に反映する人だけ | 運営から届く招待を7日以内に受け入れる | 運営に連絡する |
| GitHub Actions から GCP への認証 | 秘密なし（WIF） | GitHub の Actions の Variables（PROJECT_ID・REGION・VERTEX_LOCATION・GEMINI_MODEL・WIF_PROVIDER・DEPLOYER_SA）。任意で API_MIN_INSTANCES（API の最小インスタンス数。未登録なら 0） | 要らない | オーナーが `infra/setup-deployer.sh` の表示どおりに登録する。github-deployer にプロジェクト IAM 管理者は付けない（付いていたら外す） | オーナーが WIF のプロバイダを無効にするか、github-deployer を消す |
| AI 用サービスアカウントの鍵（`GCP_SA_KEY`） | 秘密 | クラウドの Claude Code・Codex の環境変数だけ | 任意（クラウドの AI ツールから GCP を操作するとき） | 使う人が自分で作り、自分の環境に登録する（下の手順） | 作った人かオーナーが鍵を消す |
| Firebase の Web 設定（apiKey など） | 秘密ではない | App Hosting が画面に自動で渡す | 要らない | — | — |
| Gemini | 鍵なし | Cloud Run の api-runtime が Vertex AI を権限で呼ぶ | 要らない | — | — |
| エミュレータのテストユーザー | ダミー | `firebase/seed.mjs`（`submit-allow:` 付き） | 要らない | — | — |
| 画面のプレビュー | 秘密なし（URL は公開） | App Hosting の `web-preview`。GitHub Actions が WIF で出す。動くのは `main` にあるワークフローとスクリプトだけで、PR からは `web/` だけを使う | 要らない（Collaborator なら PR を出すだけで出る） | — | ワークフロー `preview` を無効にする |
| `gh`・Claude Code・Codex のアカウント | 各自 | 各自の契約とログイン | 要る（PR を出すため） | 本人が `gh auth login`。クラウドの AI ツールは各自の GitHub 連携 | 本人がログアウトする |

## 実装担当が加わるとき

1. オーナーが、本人の GitHub のユーザー名と Google アカウントで次を実行し、本人が GitHub の招待を受け入れる（7日以内。メールか https://github.com/notifications ）。
   ```bash
   bash infra/setup-members.sh <GitHub のユーザー名> <メールアドレス>
   ```
2. 本人が clone して `bash scripts/dev.sh setup` と `bash scripts/dev.sh serve` を実行する（CONTRIBUTING の「起動する」）。ここまでで PR を出せる。
3. 画面の変更は、PR を出すとプレビューに出る（CONTRIBUTING の「画面のプレビュー」）。URL を開くのに権限は要らない。
4. 任意：本番のログ・Firestore・App Hosting のビルドを見たい、手元から本物の Gemini を試したい場合は、1 で編集者が付いた Google アカウントで `gcloud auth login` と `gcloud auth application-default login` を実行する。Firebase コンソール（https://console.firebase.google.com/project/devfest2026-t167 ）も同じアカウントで開ける。
5. 任意：クラウドの Claude Code や Codex から GCP を操作したい場合は、下の「AI 用の鍵を作る」を行う。

## AI 用の鍵を作る

鍵は人ごとに作り、ほかの人と共有しない。

```bash
source infra/env.sh
bash infra/setup-ai-access.sh               # ~/ai-dev-key.json ができる（権限が足りなければオーナーに頼む）
cat ~/ai-dev-key.json                       # 中身を、自分のクラウド環境の環境変数 GCP_SA_KEY に貼る
rm ~/ai-dev-key.json                        # 登録したらすぐ消す
gcloud iam service-accounts keys list --iam-account="ai-dev@${PROJECT_ID}.iam.gserviceaccount.com"   # 作った鍵の ID を確かめる
```

鍵の中身ではなく ID だけを、下の「AI 用の鍵の記録」に「だれの鍵か」と一緒に書いておく（鍵の ID は秘密ではない）。止めるときに、どれを消せばよいかが分かる。

- Claude Code：セッションのタイトルバーの環境メニュー →「Edit」で、環境変数 `GCP_SA_KEY` に貼る。新しいセッションで、`.claude/settings.json` のフックが自動で gcloud にログインする。
- Codex のクラウド環境：
  1. 環境の設定で、環境変数 `GCP_SA_KEY` に鍵の中身を登録する。環境変数をセットアップスクリプトの中で読めるか、エージェントの実行中にも残るかは、Codex の環境の設定画面で確かめる。
  2. タスクの最初に `bash scripts/claude-gcp-login.sh` を実行する（名前は Claude 向けだが、中身は `GCP_SA_KEY` で gcloud にログインするだけ）。続けて `export GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/gcloud/t167-key.json"` を実行する。
  3. セットアップスクリプトには `bash .codex/setup.sh` を登録する。依存、E2E 用の Chromium、Firestore エミュレータの本体を、インターネットに接続できる間に取得する。
  4. 環境のネットワーク設定で、`registry.npmjs.org`・`github.com`・`*.googleapis.com`（gcloud・Firebase・Vertex AI。エミュレータの本体も storage.googleapis.com から取得する）・Playwright のブラウザの配布元・`firebase.google.com` を許可する。
- 手元の PC の Claude Code・Codex：そのメンバーが `gcloud auth login` と `gcloud auth application-default login` をしておけば、その権限で gcloud と Admin SDK を使える。鍵は要らない。

**AI 用の鍵の記録**（鍵の ID だけを書く。中身は書かない）

| 鍵の ID | だれの鍵か | 登録した環境 | 作った日 |
|---|---|---|---|
| 7583f1593f7f5ee100d8191326c701cdb83aa5bc | 松井優知（Claude Code用） | Claude Code / devfest2026-t167（個人用） | 2026-11-08 |

## 抜けるとき・終わったとき

| いつ | だれが | すること |
|---|---|---|
| メンバーが抜けるとき | オーナー | 開発用リポジトリの Collaborator から外す。IAM から外す。その人の AI 用の鍵を `gcloud iam service-accounts keys delete <鍵の ID> --iam-account=ai-dev@${PROJECT_ID}.iam.gserviceaccount.com` で消す |
| 11/10 の提出のあと | オーナー | AI 用の鍵を、デモに使う分を残してすべて消す |
| 11/29 の GDG DevFest Tokyo のあと | オーナー | 動かし続けないなら `gcloud projects delete "$PROJECT_ID"`。サービスアカウント・鍵・WIF も一緒に消える。 |

## 漏れたとき

1. すぐに、その鍵を消す（上の `keys delete`）。トークンなら発行元で無効にする。
2. 必要なら作り直し、使っていた環境に登録し直す。
3. 公開リポジトリに push してしまった場合は、履歴から消すだけでは足りない（すでに誰でも見られた）。鍵を消したことをチームに知らせる。提出用リポジトリに入った場合は、運営にも連絡する。
4. クレジットコードが漏れた場合は、すぐに運営に連絡する。
