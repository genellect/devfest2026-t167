#!/usr/bin/env bash
# メンバーに開発の権限を付ける（オーナーが実行する。2回実行しても壊れない）。
#   メールアドレス     → GCP プロジェクトの編集者（本番のログ・Firestore・App Hosting を見る、手元から本物の Gemini を試す）
#   GitHub のユーザー名 → 開発用リポジトリの Collaborator（Write）に招待（PR を出す、プレビューを出す）
# メールアドレスは公開リポジトリに書かないので、実行するときに引数で渡す。
# 使い方: bash infra/setup-members.sh <メールアドレスか GitHub のユーザー名> ...
set -euo pipefail
source "$(dirname "$0")/env.sh"
[ $# -gt 0 ] || { sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }
for m in "$@"; do
  case "$m" in
    *@*)
      gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="user:${m}" --role=roles/editor --condition=None >/dev/null
      echo "OK: ${m} を ${PROJECT_ID} の編集者にしました" ;;
    *)
      gh api -X PUT "repos/${DEV_REPO}/collaborators/${m}" -f permission=push >/dev/null
      echo "OK: ${m} を ${DEV_REPO} の Collaborator（Write）に招待しました（受け入れ済みなら変化なし）" ;;
  esac
done
echo "招待を受け入れたかは https://github.com/${DEV_REPO}/settings/access で確かめる"
