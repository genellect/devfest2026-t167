#!/usr/bin/env bash
# scripts/dev.shから呼ぶ。クラウド設定・デプロイは変更しない。
set -euo pipefail
cd "$(dirname "$0")/.."
case "${1:-}" in
  setup)
    python3 -m venv .local-data/speaker-venv
    .local-data/speaker-venv/bin/python -m pip install -r speech/requirements.txt
    .local-data/speaker-venv/bin/python speech/setup_models.py
    ;;
  *) echo 'bash scripts/dev.sh speaker-setup を使用してください' >&2; exit 1 ;;
esac
