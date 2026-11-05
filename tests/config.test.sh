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
VARS=$(grep -oE 'vars\.[A-Z_]+' "$DEPLOY" | sed 's/vars\.//' | sorted)
[ -n "$VARS" ] && ok "deploy.yml から Variables を読めた（$VARS）" || ng "deploy.yml から Variables を読めない"
same "deploy.yml の事前検査が全部の Variables を確かめる" "$VARS" \
  "$(grep -oE 'for v in [A-Z_ ]+; do' "$DEPLOY" | head -1 | sed -E 's/for v in (.*); do/\1/' | sorted)"
same "setup-deployer.sh が全部の Variables を表示する" "$VARS" \
  "$(grep -oE '^echo "  [A-Z_]+=' "$ROOT/infra/setup-deployer.sh" | sed -E 's/echo "  ([A-Z_]+)=/\1/' | sorted)"
same "docs/credentials.md の一覧が一致する" "$VARS" \
  "$(grep 'GitHub Actions から GCP' "$ROOT/docs/credentials.md" | grep -oE 'Variables（[A-Z_・]+）' | sed -E 's/Variables（(.*)）/\1/' | sorted)"
N=$(echo "$VARS" | wc -w | tr -d ' ')
grep -q "PROJECT_ID など${N}つ" "$ROOT/CONTRIBUTING.md" && ok "CONTRIBUTING の個数が ${N}" || ng "CONTRIBUTING の「PROJECT_ID など${N}つ」がない"

# deploy.yml の事前検査の本体を取り出して実行する。空・空白だけの値で止まり、名前を表示する
awk '/name: Check repository Variables/ {f=1; next} f && /^ *- (uses|name):/ {exit} f && !/^ *run: \|/' "$DEPLOY" | sed 's/^          //' > "$T/preflight.sh"
ALL="PROJECT_ID=p REGION=r VERTEX_LOCATION=global GEMINI_MODEL=m WIF_PROVIDER=w DEPLOYER_SA=d"
env $ALL bash -e "$T/preflight.sh" > "$T/out" 2>&1 && ok "Variables がそろえば事前検査を通る" || ng "そろっているのに止まる（$(cat "$T/out")）"
env $ALL VERTEX_LOCATION= GEMINI_MODEL='  ' bash -e "$T/preflight.sh" > "$T/out" 2>&1
[ $? -ne 0 ] && grep -q "未登録です: VERTEX_LOCATION GEMINI_MODEL" "$T/out" && ok "空・空白の Variables は名前を出して止まる" || ng "空の Variables で止まらない（$(cat "$T/out")）"

# infra/env.sh：Variables のうち手元で決める値が、空でも雛形のままでもない
(
  source "$ROOT/infra/env.sh"
  for v in PROJECT_ID REGION VERTEX_LOCATION GEMINI_MODEL DEV_REPO; do
    case "${!v:-}" in ""|*ここに*) echo "$v"; esac
  done
) > "$T/unset"
[ ! -s "$T/unset" ] && ok "infra/env.sh の値が決まっている" || ng "infra/env.sh の未決定: $(tr '\n' ' ' < "$T/unset")"

# Cloud Run に渡す環境変数を、API がすべて読む（名前の打ち間違いで既定値に落ちないこと）
CONFIG="$ROOT/api/src/config.ts"
for v in $(grep -oE -- '--set-env-vars "[^"]+"' "$DEPLOY" | grep -oE '[A-Z_]+=' | tr -d '='); do
  grep -q "'$v'" "$CONFIG" && ok "API が $v を読む（deploy.yml）" || ng "API が $v を読まない（deploy.yml）"
done
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

echo "結果: ${pass} 件成功、${fail} 件失敗"
[ "$fail" -eq 0 ] && echo "ALL PASS"
[ "$fail" -eq 0 ]
