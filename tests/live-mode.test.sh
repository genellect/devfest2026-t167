#!/usr/bin/env bash
# 実APIを呼ばず、接続モードの誤指定と認証・Web設定不足で起動しないことを確認する。
set -eu
cd "$(dirname "$0")/.."
output=$(mktemp); trap 'rm -f "$output"' EXIT
if bash scripts/dev.sh serve --mode unknown >"$output" 2>&1; then echo 'FAIL: unknown mode'; exit 1; fi
grep -q 'modeはmock' "$output"
if GCP_SA_KEY='invalid-live-fixture' bash scripts/dev.sh serve --mode vertex >"$output" 2>&1; then echo 'FAIL: invalid credentials'; exit 1; fi
grep -q 'GCP_SA_KEYの形式' "$output"
if grep -q 'invalid-live-fixture' "$output"; then echo 'FAIL: credentials leaked'; exit 1; fi
if env -u NEXT_PUBLIC_FIREBASE_API_KEY -u NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN -u NEXT_PUBLIC_FIREBASE_APP_ID GCP_SA_KEY='invalid-live-fixture' bash scripts/dev.sh serve --mode cloud >"$output" 2>&1; then echo 'FAIL: missing web config'; exit 1; fi
grep -q '実接続用のFirebase Web設定' "$output"
echo 'live-mode: 3 PASS（実API未使用・認証情報の出力なし）'
