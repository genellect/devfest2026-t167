#!/usr/bin/env bash
# セッション/監査の保持期間用TTL。認証の有効性はTTLに頼らずAPIが毎回判定する。
# 既定は確認用。承認された本番反映時だけ --apply を実行する。
set -euo pipefail
source "$(dirname "$0")/env.sh"
case "${1:---plan}" in
  --plan)
    echo '適用予定: sessions/securityEvents collection-group の deleteAt TTL を有効化（既存文書にも作用）。'
    echo '監査本文はAPIで30日後のdeleteAtを付与。失効セッションも30日後に削除。'
    echo '閲覧はFirestore Rulesで全拒否。IAMのOwner/Editor/Datastore閲覧権限を運用担当がレビューする。'
    echo 'このスクリプトはIAMを変更しない。Firebase Auth/StorageバケットのIAMは別途確認する。'
    ;;
  --apply)
    for group in sessions securityEvents; do
      gcloud firestore fields ttls update deleteAt --collection-group="$group" --enable-ttl --project="$PROJECT_ID" --quiet
    done
    ;;
  *) echo '使い方: bash infra/setup-session-security.sh [--plan|--apply]' >&2; exit 1 ;;
esac
