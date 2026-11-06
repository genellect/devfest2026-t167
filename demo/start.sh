#!/bin/bash
set -euo pipefail
if [[ ! ${DEMO_ID:-} =~ ^pr[0-9]+(-[a-z0-9]+)?$ ]]; then echo 'DEMO_IDを指定してください' >&2; exit 1; fi
PORT=8081 node /app/api/dist/server.js &
api_pid=$!
web_pid=''
cleanup() { kill "$api_pid" ${web_pid:+"$web_pid"} 2>/dev/null || true; }
trap cleanup EXIT TERM INT
# APIが応答する前に公開ポートを開かず、初回ログインの転送先不在を防ぐ。
node /app/demo/wait-for-api.mjs
(cd /app/web && exec node node_modules/next/dist/bin/next start -H 0.0.0.0 -p "${PORT:-8080}") &
web_pid=$!
wait -n "$api_pid" "$web_pid"
