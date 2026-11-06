#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mode=${1:---plan}
[[ $mode == --plan || $mode == --apply ]] || { echo '--plan または --apply を指定してください' >&2; exit 1; }
[[ ${DEMO_ID:-} =~ ^pr[0-9]+$ ]] || { echo 'DEMO_IDはpr番号で指定してください' >&2; exit 1; }
[[ ${DEMO_IMAGE:-} == asia-northeast1-docker.pkg.dev/devfest2026-t167/app/pr*-demo:* ]] || { echo '専用デモイメージを指定してください' >&2; exit 1; }
args=(run deploy web-preview --project devfest2026-t167 --region asia-east1 --image "$DEMO_IMAGE" --service-account 1086529845261-compute@developer.gserviceaccount.com --no-traffic --tag "$DEMO_ID-demo" --revision-suffix "$DEMO_ID-demo-${DEMO_REVISION:-v1}" --port 8080 --cpu 2 --memory 2Gi --concurrency 8 --min-instances 0 --max-instances 2 --timeout 300 --set-env-vars "GOOGLE_CLOUD_PROJECT=devfest2026-t167,VERTEX_LOCATION=global,GEMINI_MODEL=gemini-3.5-flash,DEMO_ID=$DEMO_ID,GEMINI_MOCK=0" --quiet)
if [[ $mode == --plan ]]; then printf '%q ' "${GCLOUD_BIN:-gcloud}" "${args[@]}"; printf '\n'; exit; fi
"${GCLOUD_BIN:-gcloud}" "${args[@]}"
