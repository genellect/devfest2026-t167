#!/usr/bin/env bash
# クラウドの Claude Code セッションで、AI 用サービスアカウントで gcloud をログインさせる。
# 環境変数 GCP_SA_KEY（鍵 JSON の中身）がないときは何もしない。鍵はセッションの外に保存しない。
# プロジェクトは infra/env.sh の PROJECT_ID（環境変数 PROJECT_ID があればそちら）。値を2か所に書かないため
[ -n "${GCP_SA_KEY:-}" ] || exit 0
command -v gcloud >/dev/null 2>&1 || { echo "gcloud がないので GCP ログインを省略しました" >&2; exit 0; }
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="${PROJECT_ID:-$(source "$ROOT/infra/env.sh" && echo "$PROJECT_ID")}"
KEY="${HOME}/.config/gcloud/t167-key.json"
mkdir -p "$(dirname "$KEY")" && umask 077 && printf '%s' "$GCP_SA_KEY" > "$KEY"
gcloud auth activate-service-account --key-file="$KEY" --quiet >/dev/null 2>&1 \
  && gcloud config set project "$PROJECT" --quiet >/dev/null 2>&1 \
  && echo "GCP: AI 用サービスアカウントでログインしました（${PROJECT}）"
# Admin SDK などの標準の認証（ADC）もこの鍵を使う
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then echo "export GOOGLE_APPLICATION_CREDENTIALS=$KEY" >> "$CLAUDE_ENV_FILE"; fi
