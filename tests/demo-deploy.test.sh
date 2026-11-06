#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
cat > "$work/gcloud" <<'SH'
#!/bin/bash
printf '%s\n' "$@" > "$DEMO_TEST_LOG"
SH
chmod +x "$work/gcloud"
export DEMO_TEST_LOG="$work/calls" GCLOUD_BIN="$work/gcloud" DEMO_IMAGE=asia-northeast1-docker.pkg.dev/devfest2026-t167/app/pr34-demo:test DEMO_ID=pr34
bash "$root/demo/deploy.sh" --plan >/dev/null
[[ ! -e $DEMO_TEST_LOG ]]
if DEMO_ID=production bash "$root/demo/deploy.sh" --apply 2>/dev/null; then exit 1; fi
bash "$root/demo/deploy.sh" --apply
grep -Eq '^web-preview$' "$DEMO_TEST_LOG"
grep -Eq '^--no-traffic$' "$DEMO_TEST_LOG"
grep -Eq '^pr34-demo$' "$DEMO_TEST_LOG"
! grep -Eq '^--allow-unauthenticated$|^--to-latest$|^api$|^web$' "$DEMO_TEST_LOG"
echo 'PASS デモはweb-previewのタグだけで通常トラフィックを変更しない'
