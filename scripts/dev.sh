#!/usr/bin/env bash
# 開発の入口。人も AI エージェントも CI も、このスクリプトだけを使う。
#   bash scripts/dev.sh setup     依存を lockfile どおりに入れ、web/.env.local を用意する
#   bash scripts/dev.sh doctor    ツールと準備の状態を確かめる
#   bash scripts/dev.sh serve     エミュレータ・テストデータ・API・画面をまとめて起動（Ctrl-C で全部止まる。GEMINI_MOCK=0 で本物の Gemini）
#   bash scripts/dev.sh check     CI と同じ検査（--quick でエミュレータを使う試験を省く）
#   bash scripts/dev.sh pr        検査・push・PR の作成・auto-merge を1回で行う（--no-merge で auto-merge を付けない）
set -euo pipefail
cd "$(dirname "$0")/.."
FB="firebase/node_modules/.bin/firebase"
EMU_PROJECT=demo-t167
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099

setup() {
  for d in web api firebase; do npm ci --prefix "$d" --no-audit --no-fund; done
  [ -f web/.env.local ] || cp web/.env.example web/.env.local
  echo "OK: 依存を入れました。次は bash scripts/dev.sh doctor"
}

doctor() {
  local bad=0
  ok() { echo "[ok] $*"; }
  warn() { echo "[--] $*"; }
  ng() { echo "[!!] $*"; bad=1; }
  [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)" = "$(cat .nvmrc)" ] \
    && ok "Node.js $(node -v)" || ng "Node.js は $(cat .nvmrc) 系が必要（.nvmrc）"
  java -version >/dev/null 2>&1 && ok "Java（Firestore エミュレータ用）" || ng "Java 21 が必要（Firestore エミュレータ用）"
  for d in web api firebase; do [ -d "$d/node_modules" ] && ok "$d の依存" || ng "$d の依存がない → bash scripts/dev.sh setup"; done
  [ -x "$FB" ] && ok "Firebase CLI $("$FB" --version 2>/dev/null)（lockfile で固定）" || ng "Firebase CLI がない → bash scripts/dev.sh setup"
  [ -f web/.env.local ] && ok "web/.env.local" || ng "web/.env.local がない → bash scripts/dev.sh setup"
  if [ -n "${PW_CHROMIUM_PATH:-}" ] || ls "${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"/chromium* >/dev/null 2>&1; then ok "E2E 用の Chromium"
  else warn "E2E 用の Chromium がない → cd web && npx playwright install chromium（既存のブラウザは PW_CHROMIUM_PATH で指定）"; fi
  # GCP は本番の操作にだけ使う。ローカルの開発と試験には不要
  if command -v gcloud >/dev/null 2>&1 && [ -n "$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null)" ]; then
    ok "gcloud: $(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -1)"
  else warn "gcloud は未ログイン（ローカルの開発と試験には不要）"; fi
  return $bad
}

wait_port() { for _ in $(seq 1 60); do (echo >"/dev/tcp/127.0.0.1/$1") 2>/dev/null && return 0; sleep 1; done; echo "NG: ポート $1 が開きません" >&2; return 1; }

serve() {
  local mock="${GEMINI_MOCK:-1}" extra=()
  if [ "$mock" = 0 ]; then
    # 本物の Gemini：Firestore と Auth はエミュレータのまま、Vertex AI だけ本番のプロジェクトを使う
    source infra/env.sh
    case "${GEMINI_MODEL:-}" in ""|*ここに*) echo "NG: infra/env.sh の GEMINI_MODEL を決めてください" >&2; exit 1 ;; esac
    command -v gcloud >/dev/null 2>&1 && gcloud auth application-default print-access-token >/dev/null 2>&1 \
      || { echo "NG: 本物の Gemini には gcloud auth application-default login が要ります（プロジェクトの編集者の権限で）" >&2; exit 1; }
    extra=(VERTEX_PROJECT="$PROJECT_ID" VERTEX_LOCATION="$VERTEX_LOCATION" GEMINI_MODEL="$GEMINI_MODEL")
    echo "本物の Gemini（${PROJECT_ID} の Vertex AI、${VERTEX_LOCATION}、${GEMINI_MODEL}）を使います。Firestore と Auth はエミュレータのままです"
  fi
  trap 'trap - EXIT; kill 0' INT TERM EXIT
  "$FB" emulators:start --project "$EMU_PROJECT" --only auth,firestore >/tmp/t167-emulators.log 2>&1 &
  wait_port 8080 && wait_port 9099
  npm --prefix firebase run seed
  env GOOGLE_CLOUD_PROJECT=$EMU_PROJECT GEMINI_MOCK="$mock" PORT=8081 ${extra[@]+"${extra[@]}"} npm --prefix api run dev &
  npm --prefix web run dev &
  wait_port 3000
  echo "== http://localhost:3000 を開き、参加コード DEMO01 で参加できます（エミュレータの画面は http://localhost:4000）=="
  wait
}

check() {
  # CI と同じ値。App Hosting の apphosting.yaml は通常のビルドには使われない
  export API_ORIGIN=http://127.0.0.1:8081 NEXT_PUBLIC_USE_EMULATORS=1 NEXT_PUBLIC_FIREBASE_PROJECT_ID=$EMU_PROJECT
  step() { echo; echo "== $*"; }
  step "静的検査と単体テスト"
  npm --prefix web run lint
  npm --prefix web run typecheck
  npm --prefix web test
  npm --prefix api run typecheck
  npm --prefix api test
  bash -n scripts/*.sh infra/*.sh tests/*.sh
  bash tests/submit.test.sh
  bash tests/ci-changes.test.sh
  bash tests/dev-pr.test.sh
  step "ビルド"
  npm --prefix api run build
  npm --prefix web run build
  if [ "${1:-}" = "--quick" ]; then echo; echo "OK（--quick：Rules・API の結合・E2E は省略。PR の CI では実行される）"; return; fi
  step "エミュレータ上で Rules・API の結合・E2E"
  "$FB" emulators:exec --project "$EMU_PROJECT" --only auth,firestore \
    "npm --prefix firebase test && npm --prefix api run test:integration && npm --prefix web run e2e"
  echo; echo "OK: CI と同じ検査がすべて通りました"
}

# 変えると本番の権限・デプロイに直接効くファイル。これらを含む PR には auto-merge を付けず、レビューを求める
REVIEW_PATHS='^(firebase/firestore\.rules|firebase\.json|web/apphosting[^/]*\.yaml|\.github/|infra/)'

pr() {
  local merge=1
  [ "${1:-}" = "--no-merge" ] && merge=0
  command -v gh >/dev/null 2>&1 || { echo "NG: gh がありません（https://cli.github.com）" >&2; exit 1; }
  gh auth status >/dev/null 2>&1 || { echo "NG: gh auth login をしてください" >&2; exit 1; }
  local br; br=$(git branch --show-current)
  { [ -n "$br" ] && [ "$br" != main ]; } || { echo "NG: main では実行できません。git switch -c <種類>/<内容> でブランチを作ってください" >&2; exit 1; }
  [ -z "$(git status --porcelain)" ] || { echo "NG: コミットしていない変更があります。コミットしてから実行してください" >&2; exit 1; }
  git fetch -q origin main
  [ -n "$(git rev-list origin/main..HEAD)" ] || { echo "NG: main との差分がありません" >&2; exit 1; }
  [ "${T167_PR_SKIP_CHECK:-}" = 1 ] || check --quick
  git push -q -u origin HEAD
  if gh pr view --json number >/dev/null 2>&1; then
    echo "このブランチの PR はすでにあります。push した内容で CI がやり直されます"
  else
    local body; body=$(mktemp)
    # PR テンプレートの「変更内容」に、このブランチのコミットの件名を入れておく。残りの項目は書き足す
    awk -v list="$(git log --reverse --format='- %s' origin/main..HEAD)" '!done && /^-$/ { print list; done=1; next } { print }' \
      .github/pull_request_template.md > "$body"
    gh pr create --base main --title "$(git log --reverse --format=%s origin/main..HEAD | head -1)" --body-file "$body"
    rm -f "$body"
  fi
  local hot; hot=$(git diff --name-only origin/main...HEAD | grep -E "$REVIEW_PATHS" || true)
  if [ -n "$hot" ]; then
    echo "注意: 次のファイルを変えたので auto-merge を付けません。もう1人にレビューを頼み、承認されたら gh pr merge --auto --squash --delete-branch を実行してください:"
    echo "$hot" | sed 's/^/  /'
  elif [ "$merge" = 1 ]; then
    gh pr merge --auto --squash --delete-branch
    echo "OK: CI が通ると自動で squash merge され、本番に反映されます"
  else
    echo "OK: PR を作りました（--no-merge なので auto-merge は付けていません）"
  fi
  gh pr view --json url --jq .url
}

case "${1:-}" in
  setup) setup ;;
  doctor) doctor ;;
  serve) serve ;;
  check) shift; check "$@" ;;
  pr) shift; pr "$@" ;;
  *) sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
