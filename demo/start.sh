#!/bin/bash
set -euo pipefail
if [[ ! ${DEMO_ID:-} =~ ^pr[0-9]+(-[a-z0-9]+)?$ ]]; then echo 'DEMO_IDを指定してください' >&2; exit 1; fi
PORT=8081 node /app/api/dist/server.js &
api_pid=$!
(cd /app/web && exec node node_modules/next/dist/bin/next start -H 0.0.0.0 -p "${PORT:-8080}") &
web_pid=$!
cleanup() { kill "$api_pid" "$web_pid" 2>/dev/null || true; }
trap cleanup EXIT TERM INT
wait -n "$api_pid" "$web_pid"
