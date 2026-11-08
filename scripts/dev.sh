#!/usr/bin/env bash
# 開発の入口。人も AI エージェントも CI も、このスクリプトだけを使う。
#   bash scripts/dev.sh setup     依存を lockfile どおりに入れ、web/.env.local を用意する
#   bash scripts/dev.sh doctor    ツールと準備の状態を確かめる
#   bash scripts/dev.sh serve     エミュレータ・テストデータ・API・画面をまとめて起動（Ctrl-C で全部止まる。GEMINI_MOCK=0 で本物の Gemini）
#   bash scripts/dev.sh serve-google  実Google認証・実Gemini＋専用ローカルDBで起動
#   bash scripts/dev.sh real-check  公開音声の録音から実Geminiの結果表示まで検査
#   bash scripts/dev.sh check     CI と同じ検査（--quick でエミュレータを使う試験を省く）
#   bash scripts/dev.sh speaker-setup  ローカル話者モデルとPython環境を準備
#   bash scripts/dev.sh speaker-check  合成PCMファイル2本を実モデルで検証（SPEAKER_TEST_VOICESを指定）
#   bash scripts/dev.sh pr        検査・push・PR の作成を1回で行う。auto-merge は付けない（本番反映は Yuto Matsui の承諾の後。--approved で付ける）
set -euo pipefail
cd "$(dirname "$0")/.."
FB="firebase/node_modules/.bin/firebase"
EMU_PROJECT=demo-t167
# 同じ端末の別 checkout と検査用データ・待受ポートを共有しない。
OFFSET=${T167_TEST_PORT_OFFSET:-0}
case "$OFFSET" in ''|*[!0-9]*) echo 'NG: T167_TEST_PORT_OFFSET は0〜40000の整数です' >&2; exit 1 ;; esac
[ "${#OFFSET}" -le 5 ] && [ "$OFFSET" -le 40000 ] || { echo 'NG: ポートのオフセットが大きすぎます' >&2; exit 1; }
OFFSET=$((10#$OFFSET))
export T167_WEB_PORT=$((3000 + OFFSET)) T167_API_PORT=$((8081 + OFFSET))
export FIRESTORE_EMULATOR_HOST=127.0.0.1:$((8080 + OFFSET)) FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:$((9099 + OFFSET))
export NEXT_PUBLIC_AUTH_EMULATOR_PORT=$((9099 + OFFSET)) NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT=$((8080 + OFFSET))
export FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:$((9199 + OFFSET))
# Firebase CLI は設定ファイル基準で Rules のパスを解決するため、絶対パスにする。
emulator_config() {
  local config; config=$(mktemp /tmp/t167-emulators.XXXXXX)
  node - "$PWD" "$OFFSET" > "$config" <<'JS'
const fs = require('node:fs');
const [root, offset] = process.argv.slice(2), n = Number(offset);
const config = JSON.parse(fs.readFileSync(root + '/firebase.json'));
for (const key of ['rules', 'indexes']) config.firestore[key] = root + '/' + config.firestore[key];
config.storage.rules = root + '/' + config.storage.rules;
for (const item of Object.values(config.emulators)) if (item && typeof item === 'object' && 'port' in item) item.port += n;
config.emulators.hub = { host: '127.0.0.1', port: 4400 + n };
config.emulators.logging = { host: '127.0.0.1', port: 4500 + n };
config.emulators.firestore.websocketPort = 9150 + n;
console.log(JSON.stringify(config));
JS
  echo "$config"
}

assert_free_ports() {
  node - "$OFFSET" <<'JS'
const net = require('node:net'), offset = Number(process.argv[2]);
Promise.all([3000, 8080, 8081, 9099, 4000, 4400, 4500, 9150, 9199].map(port => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', () => reject(new Error(`ポート ${port + offset} は使用中です。T167_TEST_PORT_OFFSET を変えてください。`)));
  server.listen(port + offset, '127.0.0.1', () => server.close(resolve));
}))).catch(error => { console.error(error.message); process.exit(1); });
JS
}

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
  if command -v gcloud >/dev/null 2>&1 && gcloud auth application-default print-access-token >/dev/null 2>&1; then
    ok "ADC（GEMINI_MOCK=0 で本物の Gemini を試せる）"
  else warn "ADC なし（GEMINI_MOCK=0 で本物の Gemini を試すときだけ必要。gcloud auth application-default login）"; fi
  return $bad
}

wait_port() { for _ in $(seq 1 60); do (echo >"/dev/tcp/127.0.0.1/$1") 2>/dev/null && return 0; sleep 1; done; echo "NG: ポート $1 が開きません" >&2; return 1; }

serve() {
  export API_ORIGIN=http://127.0.0.1:$T167_API_PORT NEXT_PUBLIC_USE_EMULATORS=1 NEXT_PUBLIC_FIREBASE_PROJECT_ID=$EMU_PROJECT
  local mock="${GEMINI_MOCK:-1}" extra=()
  if [ "$mock" = 0 ]; then
    # 本物の Gemini：Firestore と Auth はエミュレータのまま、Vertex AI だけ本番のプロジェクトを使う
    source infra/env.sh
    # モデルの比較だけに使う（CONTRIBUTING の「Gemini のモデルと費用」）。本番のモデルは infra/env.sh と GitHub の Variables
    [ -n "${GEMINI_MODEL_OVERRIDE:-}" ] && GEMINI_MODEL="$GEMINI_MODEL_OVERRIDE"
    local v
    for v in PROJECT_ID VERTEX_LOCATION GEMINI_MODEL; do
      case "${!v:-}" in ""|*ここに*) echo "NG: infra/env.sh の $v を決めてください" >&2; exit 1 ;; esac
    done
    command -v gcloud >/dev/null 2>&1 \
      || { echo "NG: 本物の Gemini には Google Cloud CLI（gcloud）が要ります。.devcontainer・Codespaces には入っていません（https://cloud.google.com/sdk/docs/install）。モックでの起動は gcloud なしで使えます" >&2; exit 1; }
    gcloud auth application-default print-access-token >/dev/null 2>&1 \
      || { echo "NG: 本物の Gemini には gcloud auth application-default login が要ります（プロジェクトの編集者の権限で。docs/credentials.md の「実装担当が加わるとき」）" >&2; exit 1; }
    # 個人の ADC でも課金と割り当てをこのプロジェクトに付ける（gcloud の quota project の設定に頼らない）
    extra=(VERTEX_PROJECT="$PROJECT_ID" VERTEX_LOCATION="$VERTEX_LOCATION" GEMINI_MODEL="$GEMINI_MODEL" GOOGLE_CLOUD_QUOTA_PROJECT="$PROJECT_ID")
    echo "本物の Gemini（${PROJECT_ID} の Vertex AI、${VERTEX_LOCATION}、${GEMINI_MODEL}）を使います。Firestore と Auth はエミュレータのままです"
  fi
  assert_free_ports
  # グループへの終了通知が自分にも届くので、先に全ハンドラーを解除して再帰を防ぐ。
  trap 'trap - INT TERM EXIT; rm -f "${config:-}"; kill 0' INT TERM EXIT
  local config; config=$(emulator_config)
  local emulator_log; emulator_log=$(mktemp /tmp/t167-emulators-log.XXXXXX)
  "$FB" emulators:start --config "$config" --project "$EMU_PROJECT" --only auth,firestore,storage >"$emulator_log" 2>&1 &
  wait_port "$NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT" && wait_port "$NEXT_PUBLIC_AUTH_EMULATOR_PORT"
  npm --prefix firebase run seed
  env GOOGLE_CLOUD_PROJECT=$EMU_PROJECT GEMINI_MOCK="$mock" PORT="$T167_API_PORT" ${extra[@]+"${extra[@]}"} npm --prefix api run dev &
  npm --prefix web run dev -- -p "$T167_WEB_PORT" &
  wait_port "$T167_WEB_PORT"
  echo "== http://localhost:$T167_WEB_PORT を開き、参加コード 100001 で参加できます（エミュレータの画面は http://localhost:$((4000 + OFFSET))）=="
  wait
}

check() {
  EMU_PROJECT=demo-t167-test-$OFFSET
  export GOOGLE_CLOUD_PROJECT=$EMU_PROJECT METADATA_SERVER_DETECTION=none
  assert_free_ports
  # CI と同じ値。App Hosting の apphosting.yaml は通常のビルドには使われない
  export API_ORIGIN=http://127.0.0.1:$T167_API_PORT NEXT_PUBLIC_USE_EMULATORS=1 NEXT_PUBLIC_FIREBASE_PROJECT_ID=$EMU_PROJECT
  step() { echo; echo "== $*"; }
  step "静的検査と単体テスト"
  npm --prefix web run lint
  npm --prefix web run typecheck
  npm --prefix web test
  npm --prefix api run typecheck
  npm --prefix api test
  node scripts/mutation-check.mjs
  bash -n scripts/*.sh infra/*.sh tests/*.sh
  bash tests/submit.test.sh
  bash tests/ci-changes.test.sh
  bash tests/dev-pr.test.sh
  python3 tests/dev-serve.test.py
  node --test tests/dev-isolation.test.mjs
  node --test tests/cloud-demo.test.mjs
  bash tests/config.test.sh
  bash tests/session-security.test.sh
  node --test tests/deploy-rules.test.mjs
  node --test tests/speaker-container.test.mjs
  bash tests/demo-deploy.test.sh
  node --test tests/demo-start.test.mjs
  node --test tests/real-google.test.mjs
  node --test tests/ipad-proxy.test.mjs
  step "ビルド"
  npm --prefix api run build
  npm --prefix web run build
  if [ "${1:-}" = "--quick" ]; then echo; echo "OK（--quick：Rules・API の結合・E2E は省略。PR の CI では実行される）"; return; fi
  step "エミュレータ上で Rules・API の結合・E2E"
  local config; config=$(emulator_config)
  trap 'rm -f "${config:-}"' EXIT
  "$FB" emulators:exec --config "$config" --project "$EMU_PROJECT" --only auth,firestore,storage \
    "npm --prefix firebase test && npm --prefix api run test:coverage && npm --prefix api run test:performance && npm --prefix web run e2e"
  rm -f "$config"; trap - EXIT
  echo; echo "OK: CI と同じ検査がすべて通りました"
}


# 明示した公開音声だけを実APIへ送り、AuthとFirestoreは専用エミュレータを使う。
real_check() {
  [ -f "${T167_PUBLIC_AUDIO_FILE:-}" ] || { echo 'NG: T167_PUBLIC_AUDIO_FILEに使用許可のある公開音声WAVを指定してください' >&2; exit 1; }
  [ -x "${SPEAKER_PYTHON:-}" ] && [ -f "${SPEAKER_EMBEDDING_MODEL:-}" ] && [ -f "${SPEAKER_VAD_MODEL:-}" ] || { echo 'NG: speaker-setupで準備したPythonと話者/VADモデルを指定してください' >&2; exit 1; }
  assert_free_ports
  source infra/env.sh
  EMU_PROJECT=demo-t167-real-$OFFSET
  export GOOGLE_CLOUD_PROJECT=$EMU_PROJECT VERTEX_PROJECT=$PROJECT_ID GOOGLE_CLOUD_QUOTA_PROJECT=$PROJECT_ID
  export T167_REAL_GEMINI=1 GEMINI_MOCK=0 CLASSROOM_MOCK=0 NEXT_PUBLIC_CLASSROOM_MOCK=0
  export NEXT_PUBLIC_USE_EMULATORS=1 NEXT_PUBLIC_FIREBASE_PROJECT_ID=$EMU_PROJECT API_ORIGIN=http://127.0.0.1:$T167_API_PORT
  npm --prefix api run build
  npm --prefix web run build
  local config; config=$(emulator_config)
  trap 'rm -f "${config:-}"' EXIT
  "$FB" emulators:exec --config "$config" --project "$EMU_PROJECT" --only auth,firestore \
    "cd web && npx playwright test --config playwright.real.config.ts"
  rm -f "$config"; trap - EXIT
}


speaker_check() {
  export GOOGLE_CLOUD_PROJECT=demo-t167-test-$OFFSET METADATA_SERVER_DETECTION=none T167_REAL_SPEAKER=1
  export SPEAKER_PYTHON=${SPEAKER_PYTHON:-$PWD/.local-data/speaker-venv/bin/python}
  export SPEAKER_EMBEDDING_MODEL=${SPEAKER_EMBEDDING_MODEL:-$PWD/.local-data/speaker-models/campplus.onnx}
  export SPEAKER_VAD_MODEL=${SPEAKER_VAD_MODEL:-$PWD/.local-data/speaker-models/silero-vad.onnx}
  [ -n "${SPEAKER_TEST_VOICES:-}" ] || { echo 'NG: SPEAKER_TEST_VOICESに16kHz mono PCM16 WAVの合成音声2本（9秒以上）をカンマ区切りで指定してください' >&2; exit 1; }
  [ -x "$SPEAKER_PYTHON" ] && [ -f "$SPEAKER_EMBEDDING_MODEL" ] && [ -f "$SPEAKER_VAD_MODEL" ] || { echo 'NG: speaker-setupでモデルとPython環境を準備してください' >&2; exit 1; }
  assert_free_ports
  local config; config=$(emulator_config)
  trap 'rm -f "${config:-}"' EXIT
  "$FB" emulators:exec --config "$config" --project "$GOOGLE_CLOUD_PROJECT" --only auth,firestore \
    "cd api && npx vitest run test/integration/speaker.test.ts --reporter=verbose"
  rm -f "$config"; trap - EXIT
}

# 変えると本番の権限・デプロイに直接効くファイル。これらを含む PR には auto-merge を付けず、レビューを求める
REVIEW_PATHS='^(firebase/(firestore|storage)\.rules|firebase\.json|web/apphosting[^/]*\.yaml|\.github/|infra/|demo/)'

pr() {
  # main へのマージから自動デプロイまでが「本番反映」。始める前に Yuto Matsui の承諾が要るので、既定では auto-merge を付けない。
  # --approved：その PR の本番反映を承諾されたあとに、任された担当者が付ける。--no-merge は既定と同じ（以前の書き方のため残す）
  local merge=0
  case "${1:-}" in --approved) merge=1 ;; --no-merge|"") ;; *) echo "NG: 知らない指定です: $1（--approved か --no-merge）" >&2; exit 1 ;; esac
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
    T167_PR_COMMIT_LIST="$(git log --reverse --format='- %s' origin/main..HEAD)" \
      awk 'BEGIN { list=ENVIRON["T167_PR_COMMIT_LIST"] } !done && /^-$/ { print list; done=1; next } { print }' \
      .github/pull_request_template.md > "$body"
    gh pr create --base main --title "$(git log --reverse --format=%s origin/main..HEAD | head -1)" --body-file "$body"
    rm -f "$body"
  fi
  local hot; hot=$(git diff --name-only origin/main...HEAD | grep -E "$REVIEW_PATHS" || true)
  if [ -n "$hot" ]; then
    echo "注意: 次のファイルを変えたので auto-merge を付けません。もう1人のレビューと、Yuto Matsui の本番反映の承諾の両方を得てから、gh pr merge --auto --squash --delete-branch を実行してください:"
    echo "$hot" | sed 's/^/  /'
  elif [ "$merge" = 1 ]; then
    gh pr merge --auto --squash --delete-branch
    echo "OK: 本番反映の承諾済みとして auto-merge を付けました。CI が通ると squash merge され、本番に反映されます"
  else
    echo "OK: PR を作りました（auto-merge は付けていません）。プレビューを確かめ、PR のコメントで Yuto Matsui に本番反映の承諾を依頼してください（docs/contributor-preview-guide.md）"
  fi
  gh pr view --json url --jq .url
}

case "${1:-}" in
  setup) setup ;;
  doctor) doctor ;;
  serve) serve ;;
  serve-google) source infra/env.sh; node scripts/real-google.mjs ;;
  check) shift; check "$@" ;;
  speaker-setup) bash scripts/speaker.sh setup ;;
  speaker-check) speaker_check ;;
  real-check) real_check ;;
  pr) shift; pr "$@" ;;
  *) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
