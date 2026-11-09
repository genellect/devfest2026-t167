#!/usr/bin/env bash
# フロントエンドのプレビュー用 App Hosting バックエンドを用意する。2回実行しても壊れない。
#   1. バックエンド $PREVIEW_BACKEND を、本番と同じ Web アプリ・リージョン・ルートで作る（なければ）
#   2. その URL を Firebase Authentication の承認済みドメインに加える（なければ）。Google ログインを試せるようにするため
# .github/workflows/preview.yml が毎回呼ぶので、人が実行する必要はない。手元から実行するときは編集者の権限で gcloud にログインしておく。
# 使い方: bash infra/setup-preview.sh   （最後の行に URL を表示する）
set -euo pipefail
cd "$(dirname "$0")/.."
source infra/env.sh
FB="${T167_FIREBASE:-firebase/node_modules/.bin/firebase}"   # 回帰テストでは偽物に差し替える
P="$PROJECT_ID" B="$PREVIEW_BACKEND"

# 一覧の JSON で確かめる（apphosting:backends:get は、見つからなくても終了コード 0 で警告を出すだけのため）
EXISTS=$("$FB" apphosting:backends:list --project "$P" --non-interactive --json \
  | python3 -c "import json,sys; r=json.load(sys.stdin).get('result') or []; print('yes' if any(b.get('name','').endswith('/backends/$B') for b in r) else '')")
if [ -z "$EXISTS" ]; then
  # 本番のバックエンド web と同じ Web アプリに紐づける（--app を省くと、CLI が別の Web アプリを作るため）
  APP_ID=$("$FB" apps:list WEB --project "$P" --non-interactive --json \
    | python3 -c "import json,sys; print(next(a['appId'] for a in json.load(sys.stdin)['result'] if a.get('displayName')=='$WEB_APP_NAME'))")
  "$FB" apphosting:backends:create --backend "$B" --primary-region "$APPHOSTING_REGION" --app "$APP_ID" \
    --root-dir web --project "$P" --non-interactive >&2
  echo "OK: プレビュー用のバックエンド $B を作りました" >&2
fi

DOMAIN="${B}--${P}.${APPHOSTING_REGION}.hosted.app"
CFG="https://identitytoolkit.googleapis.com/admin/v2/projects/${P}/config"
AUTH=(-H "Authorization: Bearer $(gcloud auth print-access-token)" -H "x-goog-user-project: ${P}")
# 承認済みドメインに加えられなくても、ビルドとデプロイは止めない。その場合はプレビューで Google ログインだけが失敗する
if NEW=$(curl -fsS "${AUTH[@]}" "$CFG" | python3 -c "
import json,sys
d=json.load(sys.stdin).get('authorizedDomains',[])
print('' if '$DOMAIN' in d else json.dumps({'authorizedDomains': d+['$DOMAIN']}))"); then
  if [ -z "$NEW" ]; then :
  elif curl -fsS -X PATCH "${AUTH[@]}" -H "Content-Type: application/json" "${CFG}?updateMask=authorizedDomains" -d "$NEW" >/dev/null; then
    echo "OK: $DOMAIN を承認済みドメインに加えました" >&2
  else echo "::warning::$DOMAIN を承認済みドメインに加えられませんでした。Firebase コンソールの Authentication → Settings で加えてください" >&2; fi
else echo "::warning::承認済みドメインを読めませんでした。$DOMAIN が入っているか、Firebase コンソールで確かめてください" >&2; fi
echo "https://${DOMAIN}"
