#!/usr/bin/env bash
# 設定の受け渡しの回帰テスト。GCP と GitHub には接続しない（gcloud は記録だけする偽物）。
# 1つの値（GitHub の Variables、Gemini の接続先、プロジェクト ID）が複数のファイルに現れるので、増減や旧い値の残りをここで止める
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
pass=0 fail=0
ok() { pass=$((pass+1)); echo "PASS $1"; }
ng() { fail=$((fail+1)); echo "FAIL $1"; }
same() { [ "$2" = "$3" ] && ok "$1" || ng "$1（期待: $2 / 実際: $3）"; }
sorted() { tr ' ,・' '\n' | sed '/^$/d' | sort -u | tr '\n' ' ' | sed 's/ $//'; }

DEPLOY="$ROOT/.github/workflows/deploy.yml"
# GitHub の Variables：deploy.yml が読む名前を基準に、ほかの場所と一致するか
# 任意の Variables（未登録なら既定値で動く）は、deploy.yml の「# 任意の Variables:」の行に並べ、必須の一覧から外す
OPTIONAL=$(grep -oE '# 任意の Variables: [A-Z_ ]+' "$DEPLOY" | sed 's/# 任意の Variables: //' | sorted)
VARS=$(grep -oE 'vars\.[A-Z_]+' "$DEPLOY" | sed 's/vars\.//' | sort -u | grep -vxF -f <(echo "$OPTIONAL" | tr ' ' '\n' | sed '/^$/d') | sorted)
[ -n "$VARS" ] && ok "deploy.yml から Variables を読めた（${VARS}）" || ng "deploy.yml から Variables を読めない"
same "deploy.yml の事前検査が全部の Variables を確かめる" "$VARS" \
  "$(grep -oE 'for v in [A-Z_ ]+; do' "$DEPLOY" | head -1 | sed -E 's/for v in (.*); do/\1/' | sorted)"
same "setup-deployer.sh が全部の Variables を表示する" "$VARS" \
  "$(grep -oE '^echo "  [A-Z_]+=' "$ROOT/infra/setup-deployer.sh" | sed -E 's/echo "  ([A-Z_]+)=/\1/' | sorted)"
same "docs/credentials.md の一覧が一致する" "$VARS" \
  "$(grep 'GitHub Actions から GCP' "$ROOT/docs/credentials.md" | grep -oE 'Variables（[A-Z_・]+）' | sed -E 's/Variables（(.*)）/\1/' | sorted)"
for v in $OPTIONAL; do
  grep -q "vars.${v} || '" "$DEPLOY" && ok "任意の ${v} は未登録でも既定値で動く" || ng "任意の ${v} に既定値がない（deploy.yml）"
  grep -q "$v" "$ROOT/infra/setup-deployer.sh" && grep -q "$v" "$ROOT/docs/credentials.md" && ok "任意の ${v} を setup-deployer.sh と credentials.md が案内する" || ng "任意の ${v} の案内がない"
done
N=$(echo "$VARS" | wc -w | tr -d ' ')
grep -q "PROJECT_ID など${N}つ" "$ROOT/CONTRIBUTING.md" && ok "CONTRIBUTING の個数が ${N}" || ng "CONTRIBUTING の「PROJECT_ID など${N}つ」がない"

# deploy.yml の事前検査の本体を取り出して実行する。空・空白だけの値で止まり、名前を表示する
awk '/name: Check repository Variables/ {f=1; next} f && /^ *- (uses|name):/ {exit} f && !/^ *run: \|/' "$DEPLOY" | sed 's/^          //' > "$T/preflight.sh"
ALL="PROJECT_ID=p REGION=r VERTEX_LOCATION=global GEMINI_MODEL=m WIF_PROVIDER=w DEPLOYER_SA=d API_MIN_INSTANCES=0"
env $ALL bash -e "$T/preflight.sh" > "$T/out" 2>&1 && ok "Variables がそろえば事前検査を通る" || ng "そろっているのに止まる（$(cat "$T/out")）"
for n in 1 2; do
  env $ALL API_MIN_INSTANCES=$n bash -e "$T/preflight.sh" > "$T/out" 2>&1 && ok "API_MIN_INSTANCES=$n は通る" || ng "API_MIN_INSTANCES=$n で止まる（$(cat "$T/out")）"
done
for n in 3 -1 abc ' '; do
  env $ALL API_MIN_INSTANCES="$n" bash -e "$T/preflight.sh" > "$T/out" 2>&1
  [ $? -ne 0 ] && grep -q "API_MIN_INSTANCES は 0〜2" "$T/out" && ok "API_MIN_INSTANCES='$n' は理由を出して止まる" || ng "API_MIN_INSTANCES='$n' で止まらない（$(cat "$T/out")）"
done
grep -q -- '--min-instances "$API_MIN_INSTANCES"' "$DEPLOY" && ! grep -q -- '--min-instances [0-9]' "$DEPLOY" \
  && ok "デプロイは最小インスタンス数を Variables から渡す（手で 1 にした値を 0 に戻さない）" || ng "deploy.yml が最小インスタンス数を直書きしている"

# 文書だけの push：deploy.yml の paths-ignore と scripts/ci-changes.sh の「文書だけ」が同じ条件
same "deploy.yml の paths-ignore が ci-changes.sh の文書の条件と一致する" \
  "$(printf '%s\n' '*.md' 'docs/*' 'LICENSE' | sort | tr '\n' ' ')" \
  "$(grep -oE 'paths-ignore: \[.*\]' "$DEPLOY" | grep -oE '"[^"]+"' | tr -d '"' | sed -e 's#^\*\*/##' -e 's#/\*\*$#/*#' | sort | tr '\n' ' ')"
same "ci-changes.sh の文書の条件" "*.md|docs/*|LICENSE)" "$(grep -oE '^\s+\*\.md[^ ]*' "$ROOT/scripts/ci-changes.sh" | tr -d ' ')"
grep -q 'name: Check the production URL' "$DEPLOY" && grep -q '/api/healthz' "$DEPLOY" && ok "デプロイの最後に本番の URL の稼働を確かめる" || ng "デプロイ後の稼働確認がない"
env $ALL VERTEX_LOCATION= GEMINI_MODEL='  ' bash -e "$T/preflight.sh" > "$T/out" 2>&1
[ $? -ne 0 ] && grep -q "未登録です: VERTEX_LOCATION GEMINI_MODEL" "$T/out" && ok "空・空白の Variables は名前を出して止まる" || ng "空の Variables で止まらない（$(cat "$T/out")）"

# プレビュー：使う Variables は本番の一覧の中だけ。App Hosting のバックエンド ID が firebase.json・env.sh・ワークフローで一致する
PREVIEW="$ROOT/.github/workflows/preview.yml"
extra=$(for v in $(grep -oE 'vars\.[A-Z_]+' "$PREVIEW" | sed 's/vars\.//' | sort -u); do echo " $VARS " | grep -q " $v " || echo "$v"; done)
[ -z "$extra" ] && ok "preview.yml の Variables は登録済みの一覧の中だけ" || ng "preview.yml が未登録の Variables を使う: $extra"
BACKENDS=$(python3 -c "import json,sys; a=json.load(open(sys.argv[1]))['apphosting']; print(' '.join(sorted(b['backendId'] for b in (a if isinstance(a,list) else [a]))))" "$ROOT/firebase.json")
PB=$(source "$ROOT/infra/env.sh" && echo "$PREVIEW_BACKEND")
same "firebase.json に本番 web とプレビュー ${PB} がある" "$(printf '%s\n' web "$PB" | sort | tr '\n' ' ' | sed 's/ $//')" "$BACKENDS"
DB=$(grep -oE 'apphosting:[a-z-]+' "$DEPLOY" | head -1 | cut -d: -f2)
same "本番のデプロイ先は web（プレビューに出さない）" "web" "$DB"
grep -q 'apphosting:${PREVIEW_BACKEND}' "$PREVIEW" && ok "プレビューは PREVIEW_BACKEND だけに出す" || ng "preview.yml のデプロイ先が PREVIEW_BACKEND でない"
grep -q "head.repo.full_name == github.repository" "$PREVIEW" && ok "フォークからの PR には GCP の認証を渡さない" || ng "preview.yml にフォークの除外がない"
grep -qE '^  pull_request_target:' "$PREVIEW" && ! grep -qE '^  pull_request:' "$PREVIEW" && ok "プレビューは main のワークフローで動く（PR が書き換えても効かない）" || ng "preview.yml が PR のワークフローで動く"
grep -q 'git checkout "$SHA" -- web' "$PREVIEW" && ok "PR からは web/ だけを使い、スクリプトは main のものを使う" || ng "preview.yml が PR のスクリプトを使う"

# infra/env.sh：Variables のうち手元で決める値が、空でも雛形のままでもない
(
  source "$ROOT/infra/env.sh"
  for v in PROJECT_ID REGION VERTEX_LOCATION GEMINI_MODEL DEV_REPO WEB_APP_NAME PREVIEW_BACKEND APPHOSTING_REGION; do
    case "${!v:-}" in ""|*ここに*) echo "$v"; esac
  done
) > "$T/unset"
[ ! -s "$T/unset" ] && ok "infra/env.sh の値が決まっている" || ng "infra/env.sh の未決定: $(tr '\n' ' ' < "$T/unset")"

# Cloud Run に渡す環境変数を、API がすべて読む（名前の打ち間違いで既定値に落ちないこと）
CONFIG="$ROOT/api/src/config.ts"
for v in $(grep -oE -- '--set-env-vars "[^"]+"' "$DEPLOY" | grep -oE '[A-Z_]+=' | tr -d '='); do
  grep -q "'$v'" "$CONFIG" && ok "API が $v を読む（deploy.yml）" || ng "API が $v を読まない（deploy.yml）"
done
# infra/setup-preview.sh：偽の firebase・gcloud・curl で、作成とドメインの追加が足りないときだけ行われること
mkdir -p "$T/pv"
cat > "$T/pv/firebase" <<'EOF'
#!/usr/bin/env bash
echo "firebase $*" >> "$PV_LOG"
case "$1" in
  apphosting:backends:get) exit 0 ;;   # 実物の CLI と同じく、見つからなくても 0 で終わる
  apphosting:backends:list) if [ -f "$PV_HAS_BACKEND" ]; then echo '{"status":"success","result":[{"name":"projects/p/locations/asia-east1/backends/web"},{"name":"projects/p/locations/asia-east1/backends/web-preview"}]}'; else echo '{"status":"success","result":[{"name":"projects/p/locations/asia-east1/backends/web"}]}'; fi ;;
  apps:list) echo '{"result":[{"appId":"1:9:web:other","displayName":"web"},{"appId":"1:9:web:main","displayName":"t167-web"}]}' ;;
  apphosting:backends:create) touch "$PV_HAS_BACKEND" ;;
esac
EOF
printf '#!/usr/bin/env bash\necho dummy-token\n' > "$T/pv/gcloud"
cat > "$T/pv/curl" <<'EOF'
#!/usr/bin/env bash
for a in "$@"; do [ "$a" = PATCH ] && { echo "curl PATCH $*" >> "$PV_LOG"; exit 0; }; done
cat "$PV_DOMAINS"
EOF
chmod +x "$T/pv/"*
pv() { PATH="$T/pv:$PATH" T167_FIREBASE="$T/pv/firebase" PV_LOG="$T/pv.log" PV_HAS_BACKEND="$T/pv.has" PV_DOMAINS="$T/pv.domains" bash "$ROOT/infra/setup-preview.sh" 2>/dev/null; }
URL="https://$(source "$ROOT/infra/env.sh" && echo "${PREVIEW_BACKEND}--${PROJECT_ID}.${APPHOSTING_REGION}").hosted.app"
rm -f "$T/pv.log" "$T/pv.has"; echo '{"authorizedDomains":["localhost"]}' > "$T/pv.domains"
same "プレビューの URL を表示する" "$URL" "$(pv)"
grep -q "apphosting:backends:create --backend ${PB} .*--app 1:9:web:main " "$T/pv.log" && ok "バックエンドがなければ本番と同じ Web アプリで作る" || ng "バックエンドの作成（$(cat "$T/pv.log")）"
grep -q "curl PATCH .*${URL#https://}" "$T/pv.log" && grep "curl PATCH" "$T/pv.log" | grep -q localhost && ok "承認済みドメインに既存を残して加える" || ng "承認済みドメインの追加（$(cat "$T/pv.log")）"
rm -f "$T/pv.log"; echo "{\"authorizedDomains\":[\"localhost\",\"${URL#https://}\"]}" > "$T/pv.domains"
pv >/dev/null
grep -qE "backends:create|PATCH" "$T/pv.log" && ng "2回目に変更した（$(cat "$T/pv.log")）" || ok "2回目は何も作らず、何も変えない"

# infra/setup-members.sh：メールアドレスは GCP の編集者、それ以外は GitHub の Collaborator（Write）
mkdir -p "$T/mb"
printf '#!/usr/bin/env bash\necho "gcloud $*" >> "$MB_LOG"\n' > "$T/mb/gcloud"
printf '#!/usr/bin/env bash\necho "gh $*" >> "$MB_LOG"\n' > "$T/mb/gh"
chmod +x "$T/mb/"*
rm -f "$T/mb.log"
PATH="$T/mb:$PATH" MB_LOG="$T/mb.log" bash "$ROOT/infra/setup-members.sh" member@example.com someone >/dev/null 2>&1
grep -q "add-iam-policy-binding $(source "$ROOT/infra/env.sh" && echo "$PROJECT_ID") --member=user:member@example.com --role=roles/editor" "$T/mb.log" && ok "メールアドレスは GCP の編集者にする" || ng "編集者の付与（$(cat "$T/mb.log" 2>/dev/null)）"
grep -q "gh api -X PUT repos/$(source "$ROOT/infra/env.sh" && echo "$DEV_REPO")/collaborators/someone -f permission=push" "$T/mb.log" && ok "GitHub のユーザー名は Collaborator（Write）に招待する" || ng "Collaborator の招待（$(cat "$T/mb.log" 2>/dev/null)）"
grep -q "^for ROLE in.*projectIamAdmin" "$ROOT/infra/setup-deployer.sh" && ng "デプロイ用アカウントにプロジェクト IAM 管理者を付けている" || ok "デプロイ用アカウントにプロジェクト IAM 管理者を付けない"

# 手元の GEMINI_MOCK=0 で dev.sh が渡す値も同じ（GOOGLE_CLOUD_QUOTA_PROJECT は認証ライブラリが読む）
for v in $(grep -E '^\s*extra=\(' "$ROOT/scripts/dev.sh" | grep -oE '[A-Z_]+=' | tr -d '='); do
  [ "$v" = GOOGLE_CLOUD_QUOTA_PROJECT ] && continue
  grep -q "'$v'" "$CONFIG" && ok "API が $v を読む（dev.sh）" || ng "API が $v を読まない（dev.sh）"
done
grep -qE "asia-northeast1|'global'" "$CONFIG" "$ROOT/api/src/server.ts" \
  && ng "API に接続先の既定値が残っている" || ok "API に接続先の既定値がない"

# クラウドの Claude Code のログイン：プロジェクトは infra/env.sh と同じ
PROJECT=$(source "$ROOT/infra/env.sh" && echo "$PROJECT_ID")
mkdir -p "$T/bin" "$T/home"
cat > "$T/bin/gcloud" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "$GCLOUD_LOG"
EOF
chmod +x "$T/bin/gcloud"
login() { env -u PROJECT_ID HOME="$T/home" PATH="$T/bin:$PATH" GCLOUD_LOG="$T/gcloud.log" CLAUDE_ENV_FILE="$T/envfile" "$@" bash "$ROOT/scripts/claude-gcp-login.sh" >/dev/null 2>&1; }
rm -f "$T/gcloud.log"; login GCP_SA_KEY='{"dummy":true}'  # submit-allow: テスト用のダミー
grep -q "config set project ${PROJECT} " "$T/gcloud.log" 2>/dev/null && ok "ログインは infra/env.sh の ${PROJECT} を使う" \
  || ng "ログインのプロジェクトが違う（$(grep 'config set' "$T/gcloud.log" 2>/dev/null)）"
rm -f "$T/gcloud.log"; login GCP_SA_KEY='{"dummy":true}' PROJECT_ID=other-project  # submit-allow: テスト用のダミー
grep -q "config set project other-project " "$T/gcloud.log" 2>/dev/null && ok "環境変数 PROJECT_ID があればそちらを使う" || ng "環境変数 PROJECT_ID を使わない"
rm -f "$T/gcloud.log"; login GCP_SA_KEY=
[ ! -e "$T/gcloud.log" ] && ok "GCP_SA_KEY がなければ gcloud を呼ばない" || ng "GCP_SA_KEY がないのに gcloud を呼んだ"

# 手元の GEMINI_MOCK=0：gcloud がない・ADC がないときに、エミュレータを起動する前に理由を出して止まる
mkdir -p "$T/nogcloud"; ln -s "$(command -v dirname)" "$T/nogcloud/dirname"
PATH="$T/nogcloud" GEMINI_MOCK=0 "$BASH" "$ROOT/scripts/dev.sh" serve > "$T/out" 2>&1
[ $? -ne 0 ] && grep -q "Google Cloud CLI" "$T/out" && ok "gcloud がなければ入れ方を案内して止まる" || ng "gcloud がないときの案内（$(cat "$T/out")）"
cat > "$T/bin/gcloud" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
PATH="$T/bin:$PATH" GEMINI_MOCK=0 bash "$ROOT/scripts/dev.sh" serve > "$T/out" 2>&1
[ $? -ne 0 ] && grep -q "application-default login" "$T/out" && ok "ADC がなければ login を案内して止まる" || ng "ADC がないときの案内（$(cat "$T/out")）"

# 検査をやり直さない条件：PR の CI が検査を通ったツリーを記録し、deploy が同じ名前で照合する（docs/infra-manual.md「CI とデプロイ」）
CI="$ROOT/.github/workflows/ci.yml"
awk '/run: bash scripts\/dev.sh check/{c=1} c && /name: tested-tree-\$\{\{ env.TESTED_TREE \}\}/{print "ok"; exit}' "$CI" | grep -q ok \
  && ok "PR の CI は、検査を通ったあとでだけツリーを記録する" || ng "ci.yml が検査の前にツリーを記録しているか、記録していない"
grep -A4 'name: tested-tree-' "$CI" | grep -q 'if-no-files-found: error' && ok "記録が残らなければ CI を失敗にする" || ng "ci.yml の記録に if-no-files-found: error がない"
grep -A3 'name: tested-tree-' "$CI" | grep -E 'path: *\.' >/dev/null && ng "記録に「.」で始まるファイルを使っている（upload-artifact が除外する）" || ok "記録は「.」で始まらないファイルで残す"
grep -q 'artifacts?name=tested-tree-${TREE}' "$DEPLOY" && ok "deploy は main のツリーと同じ名前の記録を探す" || ng "deploy.yml が ci.yml の記録の名前と一致しない"
grep -q "needs.tested.outputs.ok != 'true'" "$DEPLOY" && ok "記録がないか確かめられないときは、deploy の中で検査する" || ng "deploy.yml が記録のないときに検査しない"
# 期限切れの記録と、フォークの PR の記録は数えない（deploy.yml の jq の式を取り出して確かめる）
JQ=$(grep -o '\[\.artifacts\[\][^"]*length' "$DEPLOY" | sed 's/\${REPO_ID}/42/')
printf '%s' '{"artifacts":[{"expired":false,"workflow_run":{"head_repository_id":42}},{"expired":true,"workflow_run":{"head_repository_id":42}},{"expired":false,"workflow_run":{"head_repository_id":7}}]}' > "$T/artifacts.json"
same "期限内で、このリポジトリのブランチの記録だけを数える" "1" "$(jq "$JQ" "$T/artifacts.json" 2>&1)"
printf '%s' '{"artifacts":[{"expired":true,"workflow_run":{"head_repository_id":42}},{"expired":false,"workflow_run":{"head_repository_id":7}}]}' > "$T/artifacts.json"
same "期限切れとフォークの記録しかなければ 0 件" "0" "$(jq "$JQ" "$T/artifacts.json" 2>&1)"

echo "結果: ${pass} 件成功、${fail} 件失敗"
[ "$fail" -eq 0 ] && echo "ALL PASS"
[ "$fail" -eq 0 ]
